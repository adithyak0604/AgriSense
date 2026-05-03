"""
Paddy Disease Prediction Script
Uses a fine-tuned DenseNet121 (Keras/TensorFlow) model to classify paddy
leaf images into 10 categories:

  0: bacterial_leaf_blight
  1: bacterial_leaf_streak
  2: bacterial_panicle_blight
  3: blast
  4: brown_spot
  5: dead_heart
  6: downy_mildew
  7: hispa
  8: normal
  9: tungro
"""

import json
import argparse
from pathlib import Path

import numpy as np
from PIL import Image


# ── Constants ─────────────────────────────────────────────────────────────────

LABELS_PATH = "paddy_labels.json"
IMG_SIZE    = 256    # DenseNet121 trained with (256, 256, 3)


# ── Helpers ───────────────────────────────────────────────────────────────────

def load_labels(path: str) -> dict:
    """Load the {index: class_name} mapping from JSON."""
    with open(path, "r") as f:
        raw = json.load(f)
    return {int(k): v for k, v in raw.items()}


def load_model(model_path: str, num_classes: int = 10):
    """
    Load the Keras DenseNet121 model. Handles:
      1. Keras 2 → 3 incompatibilities (BatchNormalization axis list,
         DepthwiseConv2D groups arg) patched automatically.
      2. Full model saved with model.save() → loaded directly.
      3. Weights-only saved with model.save_weights() → architecture
         rebuilt first, then weights loaded.
    """
    import tensorflow as tf
    from tensorflow.keras.layers import BatchNormalization, DepthwiseConv2D

    # ── Keras 2 → 3 patches ───────────────────────────────────────────────────
    bn_original = BatchNormalization.from_config.__func__
    @classmethod
    def patched_bn(cls, config):
        if isinstance(config.get("axis"), list):
            config["axis"] = config["axis"][0]
        return bn_original(cls, config)
    BatchNormalization.from_config = patched_bn

    dw_original = DepthwiseConv2D.from_config.__func__
    @classmethod
    def patched_dw(cls, config):
        config.pop("groups", None)
        return dw_original(cls, config)
    DepthwiseConv2D.from_config = patched_dw
    # ─────────────────────────────────────────────────────────────────────────

    try:
        model = tf.keras.models.load_model(model_path)
        print(f"✓ Full model loaded from '{model_path}'")
    except ValueError:
        print("⚠ No model config found — rebuilding DenseNet121 architecture "
              "and loading weights only...")
        model = build_densenet_model(num_classes)
        model(np.zeros((1, IMG_SIZE, IMG_SIZE, 3), dtype=np.float32))
        model.load_weights(model_path)
        print(f"✓ Weights loaded from '{model_path}'")

    return model


def build_densenet_model(num_classes: int):
    """
    Recreate the exact architecture from the notebook:
      DenseNet121(pooling='avg') → BatchNormalization → Dropout(0.35)
      → Dense(220, relu) → Dense(num_classes, softmax)
    """
    import tensorflow as tf
    from tensorflow.keras.applications import DenseNet121
    from tensorflow.keras.layers import BatchNormalization, Dropout, Dense
    from tensorflow.keras.models import Sequential

    base = DenseNet121(weights=None, include_top=False,
                       input_shape=(IMG_SIZE, IMG_SIZE, 3), pooling='avg')
    base.trainable = False

    model = Sequential([
        base,
        BatchNormalization(),
        Dropout(0.35),
        Dense(220, activation='relu'),
        Dense(num_classes, activation='softmax'),
    ])
    return model


def preprocess_image(image_path: str, img_size: int) -> np.ndarray:
    """
    Load and preprocess a single image matching the training pipeline:
      - Resize to (img_size, img_size)
      - Apply DenseNet121's preprocess_input (scales to [-1, 1])
      - Add batch dimension → shape (1, img_size, img_size, 3)
    """
    from tensorflow.keras.applications.densenet import preprocess_input

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
        print(f"    {cls:<30} {prob * 100:5.1f}%  {bar}")
    print(f"{'─' * 50}")


# ── CLI ───────────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Paddy Disease Detector — DenseNet121 (Keras)"
    )
    parser.add_argument(
        "--model", required=True,
        help="Path to the saved Keras model (e.g. paddy_disease_densenet121.h5)"
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
            print(f"    {cls:<30} {n} image(s)")
        print(f"{'─' * 50}\n")


if __name__ == "__main__":
    main()
