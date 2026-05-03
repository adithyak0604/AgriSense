"""
Mango Leaf Disease Prediction Script
Uses a fine-tuned EfficientNetB7 (Keras/TensorFlow) model to classify mango
leaf images into 8 disease categories:

  0: Anthracnose
  1: Bacterial Canker
  2: Cutting Weevil
  3: Die Back
  4: Gall Midge
  5: Healthy
  6: Powdery Mildew
  7: Sooty Mould

Architecture (from notebook):
  EfficientNetB7(pooling='max') → BatchNormalization(axis=-1, momentum=0.99, epsilon=0.001)
  → Dense(128, relu, l2+l1 regularizers) → Dropout(0.45) → Dense(8, softmax)

Preprocessing: efficientnet.preprocess_input  (scales pixels to [-1, 1])
Image size   : 224 × 224
Save format  : weights-only (.h5) via model.save_weights()
"""

import json
import argparse
from pathlib import Path

import numpy as np
from PIL import Image


# ── Constants ─────────────────────────────────────────────────────────────────

LABELS_PATH = "mango_labels.json"
IMG_SIZE    = 224    # notebook: img_size = (224, 224)


# ── Helpers ───────────────────────────────────────────────────────────────────

def load_labels(path: str) -> dict:
    """Load the {index: class_name} mapping from JSON."""
    with open(path, "r") as f:
        raw = json.load(f)
    return {int(k): v for k, v in raw.items()}


def build_model(num_classes: int):
    """
    Exact architecture from the notebook:
      EfficientNetB7(include_top=False, pooling='max')
      → BatchNormalization(axis=-1, momentum=0.99, epsilon=0.001)
      → Dense(128, relu, l2=0.016 / l1_activity=0.006 / l1_bias=0.006)
      → Dropout(0.45, seed=123)
      → Dense(num_classes, softmax)
    """
    import tensorflow as tf
    from tensorflow.keras.models import Sequential
    from tensorflow.keras.layers import Dense, Dropout, BatchNormalization
    from tensorflow.keras import regularizers

    base = tf.keras.applications.efficientnet.EfficientNetB7(
        include_top=False,
        weights=None,
        input_shape=(IMG_SIZE, IMG_SIZE, 3),
        pooling='max'
    )
    base.trainable = False

    model = Sequential([
        base,
        BatchNormalization(axis=-1, momentum=0.99, epsilon=0.001),
        Dense(
            128,
            kernel_regularizer=regularizers.l2(0.016),
            activity_regularizer=regularizers.l1(0.006),
            bias_regularizer=regularizers.l1(0.006),
            activation='relu'
        ),
        Dropout(rate=0.45, seed=123),
        Dense(num_classes, activation='softmax'),
    ])
    return model


def load_model(model_path: str, num_classes: int = 8):
    """
    Load the model. This notebook always saved weights-only via
    model.save_weights(), so we always rebuild the architecture
    then load the weights.

    Also handles the rare case where someone saved the full model
    with model.save() — tries that first.
    """
    import tensorflow as tf

    # ── Keras 2 → 3 patches (precaution for full-model load path) ────────────
    from tensorflow.keras.layers import BatchNormalization, DepthwiseConv2D

    bn_orig = BatchNormalization.from_config.__func__
    @classmethod
    def patched_bn(cls, config):
        if isinstance(config.get("axis"), list):
            config["axis"] = config["axis"][0]
        return bn_orig(cls, config)
    BatchNormalization.from_config = patched_bn

    dw_orig = DepthwiseConv2D.from_config.__func__
    @classmethod
    def patched_dw(cls, config):
        config.pop("groups", None)
        return dw_orig(cls, config)
    DepthwiseConv2D.from_config = patched_dw
    # ─────────────────────────────────────────────────────────────────────────

    # Try full model load first (in case user re-saved with model.save())
    try:
        model = tf.keras.models.load_model(model_path)
        print(f"✓ Full model loaded from '{model_path}'")
        return model
    except Exception:
        pass

    # Weights-only path (default for this notebook)
    print(f"⚠ Loading as weights-only — rebuilding EfficientNetB7 architecture...")
    model = build_model(num_classes)
    # Build the graph before loading weights
    model(np.zeros((1, IMG_SIZE, IMG_SIZE, 3), dtype=np.float32))
    model.load_weights(model_path)
    print(f"✓ Weights loaded from '{model_path}'")
    return model


def preprocess_image(image_path: str, img_size: int) -> np.ndarray:
    """
    Load and preprocess a single image matching the training pipeline:
      - Resize to (img_size, img_size)
      - Apply efficientnet.preprocess_input  (scales pixels to [-1, 1])
      - Add batch dimension → shape (1, img_size, img_size, 3)
    """
    from tensorflow.keras.applications.efficientnet import preprocess_input

    img = Image.open(image_path).convert("RGB")
    img = img.resize((img_size, img_size))
    arr = np.array(img, dtype=np.float32)
    arr = preprocess_input(arr)
    return np.expand_dims(arr, axis=0)   # (1, H, W, 3)


def predict_single(image_path: str, model, labels: dict,
                   img_size: int = IMG_SIZE) -> dict:
    """
    Run inference on a single image file.

    Returns a dict with:
        - predicted_class : str   — class name
        - predicted_index : int   — class index
        - confidence      : float — probability of top class (0–1)
        - probabilities   : dict  — {class_name: probability} for all classes
    """
    tensor = preprocess_image(image_path, img_size)
    preds  = model.predict(tensor, verbose=0)[0]   # (num_classes,)

    top_idx  = int(np.argmax(preds))
    top_prob = float(preds[top_idx])

    all_probs = {labels[i]: round(float(p), 4) for i, p in enumerate(preds)}

    return {
        "predicted_class": labels[top_idx],
        "predicted_index": top_idx,
        "confidence":      round(top_prob, 4),
        "probabilities":   all_probs,
    }


def predict_batch(image_dir: str, model, labels: dict,
                  img_size: int = IMG_SIZE) -> list:
    """
    Run inference on every image inside a directory.

    Returns a list of result dicts (same schema as predict_single),
    each augmented with an 'image' key.
    """
    supported = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
    paths = [p for p in Path(image_dir).iterdir()
             if p.suffix.lower() in supported]

    if not paths:
        print(f"No supported images found in '{image_dir}'.")
        return []

    results = []
    for path in sorted(paths):
        result = predict_single(str(path), model, labels, img_size)
        result["image"] = path.name
        results.append(result)

    return results


def print_result(result: dict) -> None:
    """Pretty-print a single prediction result."""
    print(f"\n{'─' * 50}")
    if "image" in result:
        print(f"  Image       : {result['image']}")
    print(f"  Prediction  : {result['predicted_class']}")
    print(f"  Confidence  : {result['confidence'] * 100:.1f}%")
    print("  All probabilities:")
    for cls, prob in result["probabilities"].items():
        bar = "█" * int(prob * 20)
        print(f"    {cls:<20} {prob * 100:5.1f}%  {bar}")
    print(f"{'─' * 50}")


# ── CLI ───────────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Mango Leaf Disease Detector — EfficientNetB7 (Keras)"
    )
    parser.add_argument(
        "--model", required=True,
        help="Path to the saved weights file (e.g. my_model_weights.h5)"
    )
    parser.add_argument(
        "--labels", default=LABELS_PATH,
        help=f"Path to class-labels JSON (default: {LABELS_PATH})"
    )
    parser.add_argument(
        "--img_size", type=int, default=IMG_SIZE,
        help=f"Input image size used during training (default: {IMG_SIZE})"
    )

    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--image", help="Path to a single image for prediction")
    group.add_argument("--dir",   help="Path to a directory of images for batch prediction")

    return parser.parse_args()


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    args   = parse_args()
    labels = load_labels(args.labels)
    model  = load_model(args.model, num_classes=len(labels))

    if args.image:
        result = predict_single(args.image, model, labels, args.img_size)
        print_result(result)

    else:
        results = predict_batch(args.dir, model, labels, args.img_size)
        for r in results:
            print_result(r)

        from collections import Counter
        counts = Counter(r["predicted_class"] for r in results)
        print(f"\n{'─' * 50}")
        print(f"  Batch summary  ({len(results)} images)")
        for cls, n in counts.most_common():
            print(f"    {cls:<20} {n} image(s)")
        print(f"{'─' * 50}\n")


if __name__ == "__main__":
    main()
