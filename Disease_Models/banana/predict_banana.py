"""
Banana Leaf Disease Prediction Script
Uses a soft-voting ensemble of 3 Keras models to classify banana
leaf images into 7 disease categories:

  0: Augmented Banana Black Sigatoka Disease
  1: Augmented Banana Bract Mosaic Virus Disease
  2: Augmented Banana Healthy Leaf
  3: Augmented Banana Insect Pest Disease
  4: Augmented Banana Moko Disease
  5: Augmented Banana Panama Disease
  6: Augmented Banana Yellow Sigatoka Disease

The notebook trained and saved 3 models:
  - model_lenet.h5      : Custom LeNet-style CNN
  - model_resnet.h5     : ResNet50-based transfer learning model
  - model_inception.h5  : InceptionV3-based transfer learning model

Inference uses soft voting: average probabilities across all 3 models.
You can also run with just one or two models if some are unavailable.
"""

import json
import argparse
from pathlib import Path

import numpy as np
from PIL import Image


# ── Constants ─────────────────────────────────────────────────────────────────

LABELS_PATH = "banana_labels.json"
IMG_SIZE    = 128    # All 3 models trained with (128, 128)


# ── Helpers ───────────────────────────────────────────────────────────────────

def load_labels(path: str) -> dict:
    """Load the {index: class_name} mapping from JSON."""
    with open(path, "r") as f:
        raw = json.load(f)
    return {int(k): v for k, v in raw.items()}


def patch_keras_compat():
    """
    Patch Keras 2 → Keras 3 layer config incompatibilities:
      - BatchNormalization: axis saved as list [3], Keras 3 expects int
      - DepthwiseConv2D: 'groups' arg not accepted in Keras 3
    Applied once before any model load.
    """
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


def build_resnet_model(num_classes: int):
    """
    Exact ResNet50 architecture from the notebook:
      ResNet50(include_top=False) → GlobalAveragePooling2D
      → Dense(128, relu) → BatchNormalization → Dropout(0.5)
      → Dense(num_classes, softmax)
    """
    from tensorflow.keras.applications import ResNet50
    from tensorflow.keras.layers import (GlobalAveragePooling2D, Dense,
                                         Dropout, BatchNormalization)
    from tensorflow.keras.models import Sequential

    base = ResNet50(weights=None, include_top=False,
                    input_shape=(IMG_SIZE, IMG_SIZE, 3))
    base.trainable = False
    model = Sequential([
        base,
        GlobalAveragePooling2D(),
        Dense(128, activation='relu'),
        BatchNormalization(),
        Dropout(0.5),
        Dense(num_classes, activation='softmax'),
    ])
    return model


def build_inception_model(num_classes: int):
    """
    Exact InceptionV3 architecture from the notebook:
      InceptionV3(include_top=False) → GlobalAveragePooling2D
      → Dense(128, relu) → BatchNormalization → Dropout(0.5)
      → Dense(num_classes, softmax)
    """
    from tensorflow.keras.applications import InceptionV3
    from tensorflow.keras.layers import (GlobalAveragePooling2D, Dense,
                                         Dropout, BatchNormalization)
    from tensorflow.keras.models import Sequential

    base = InceptionV3(weights=None, include_top=False,
                       input_shape=(IMG_SIZE, IMG_SIZE, 3))
    base.trainable = False
    model = Sequential([
        base,
        GlobalAveragePooling2D(),
        Dense(128, activation='relu'),
        BatchNormalization(),
        Dropout(0.5),
        Dense(num_classes, activation='softmax'),
    ])
    return model


def load_single_model(model_path: str, label: str, num_classes: int,
                      rebuild_fn=None):
    """
    Load one Keras model.
    - Tries full model load first.
    - If that fails (Keras 2→3 incompatibility with pooling+Dense wiring),
      rebuilds the architecture using rebuild_fn and loads weights only.
    """
    import tensorflow as tf
    # Try full model load
    try:
        model = tf.keras.models.load_model(model_path)
        print(f"✓ {label} loaded from '{model_path}'")
        return model
    except Exception as e:
        if rebuild_fn is None:
            print(f"✗ Failed to load {label} from '{model_path}': {e}")
            return None

    # Fall back: rebuild architecture + load weights
    try:
        print(f"⚠ Full load failed for {label} — rebuilding architecture "
              f"and loading weights only...")
        model = rebuild_fn(num_classes)
        model(np.zeros((1, IMG_SIZE, IMG_SIZE, 3), dtype=np.float32))
        model.load_weights(model_path)
        print(f"✓ {label} weights loaded from '{model_path}'")
        return model
    except Exception as e2:
        print(f"✗ Failed to load {label} weights from '{model_path}': {e2}")
        return None


def load_models(lenet_path: str, resnet_path: str, inception_path: str,
                num_classes: int) -> list:
    """
    Load all available models. At least one must be provided.
    ResNet50 and InceptionV3 fall back to weights-only loading if full
    model load fails due to Keras 2→3 pooling+Dense wiring changes.
    Returns a list of (model, name) tuples for loaded models.
    """
    patch_keras_compat()

    models = []
    for path, name, rebuild_fn in [
        (lenet_path,     "LeNet",      None),
        (resnet_path,    "ResNet50",   build_resnet_model),
        (inception_path, "InceptionV3",build_inception_model),
    ]:
        if path:
            m = load_single_model(path, name, num_classes, rebuild_fn)
            if m is not None:
                models.append((m, name))

    if not models:
        raise RuntimeError("No models could be loaded. Check your model paths.")

    print(f"\n✓ {len(models)} model(s) loaded for ensemble inference.")
    return models


def preprocess_image(image_path: str, img_size: int) -> np.ndarray:
    """
    Load and preprocess a single image matching the training pipeline:
      - Resize to (img_size, img_size)
      - Convert to array
      - Scale pixels to [0, 1]  (matches ImageDataGenerator rescale=1./255)
      - Add batch dimension → shape (1, img_size, img_size, 3)
    """
    img = Image.open(image_path).convert("RGB")
    img = img.resize((img_size, img_size))
    arr = np.array(img, dtype=np.float32) / 255.0
    return np.expand_dims(arr, axis=0)   # (1, H, W, 3)


def predict_single(image_path: str, models: list, labels: dict,
                   img_size: int = IMG_SIZE) -> dict:
    """
    Run soft-voting ensemble inference on a single image.

    Each model produces a probability vector; vectors are averaged
    and the class with the highest average probability is selected.

    Returns a dict with:
        - predicted_class  : str   — class name
        - predicted_index  : int   — class index
        - confidence       : float — averaged probability of top class (0–1)
        - probabilities    : dict  — {class_name: avg_probability} all classes
        - model_predictions: dict  — per-model top prediction for transparency
    """
    tensor = preprocess_image(image_path, img_size)
    num_classes = len(labels)

    all_probs   = np.zeros(num_classes, dtype=np.float32)
    model_preds = {}

    for model, name in models:
        preds = model.predict(tensor, verbose=0)[0]   # (num_classes,)
        all_probs += preds
        top = int(np.argmax(preds))
        model_preds[name] = {
            "predicted_class": labels[top],
            "confidence":      round(float(preds[top]), 4),
        }

    # Average across models (soft voting)
    avg_probs = all_probs / len(models)
    top_idx   = int(np.argmax(avg_probs))
    top_prob  = float(avg_probs[top_idx])

    probs_dict = {labels[i]: round(float(avg_probs[i]), 4)
                  for i in range(num_classes)}

    return {
        "predicted_class":   labels[top_idx],
        "predicted_index":   top_idx,
        "confidence":        round(top_prob, 4),
        "probabilities":     probs_dict,
        "model_predictions": model_preds,
    }


def predict_batch(image_dir: str, models: list, labels: dict,
                  img_size: int = IMG_SIZE) -> list:
    """
    Run ensemble inference on every image inside a directory.

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
        result = predict_single(str(path), models, labels, img_size)
        result["image"] = path.name
        results.append(result)

    return results


def print_result(result: dict) -> None:
    """Pretty-print a single prediction result."""
    print(f"\n{'─' * 55}")
    if "image" in result:
        print(f"  Image        : {result['image']}")
    print(f"  Prediction   : {result['predicted_class']}")
    print(f"  Confidence   : {result['confidence'] * 100:.1f}%")
    print("  All probabilities (ensemble average):")
    for cls, prob in result["probabilities"].items():
        bar = "█" * int(prob * 20)
        print(f"    {cls:<45} {prob * 100:5.1f}%  {bar}")
    print("  Per-model predictions:")
    for model_name, pred in result["model_predictions"].items():
        print(f"    {model_name:<12} → {pred['predicted_class']} "
              f"({pred['confidence']*100:.1f}%)")
    print(f"{'─' * 55}")


# ── CLI ───────────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Banana Leaf Disease Detector — Soft-Voting Ensemble "
                    "(LeNet + ResNet50 + InceptionV3)"
    )
    parser.add_argument(
        "--lenet",
        help="Path to LeNet model file (e.g. model_lenet.h5)"
    )
    parser.add_argument(
        "--resnet",
        help="Path to ResNet50 model file (e.g. model_resnet.h5)"
    )
    parser.add_argument(
        "--inception",
        help="Path to InceptionV3 model file (e.g. model_inception.h5)"
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
    args = parse_args()

    if not any([args.lenet, args.resnet, args.inception]):
        raise SystemExit(
            "Error: Provide at least one model path "
            "(--lenet, --resnet, or --inception)."
        )

    labels = load_labels(args.labels)
    models = load_models(args.lenet, args.resnet, args.inception,
                         num_classes=len(labels))

    if args.image:
        result = predict_single(args.image, models, labels, args.img_size)
        print_result(result)

    else:
        results = predict_batch(args.dir, models, labels, args.img_size)
        for r in results:
            print_result(r)

        from collections import Counter
        counts = Counter(r["predicted_class"] for r in results)
        print(f"\n{'─' * 55}")
        print(f"  Batch summary  ({len(results)} images)")
        for cls, n in counts.most_common():
            print(f"    {cls:<45} {n} image(s)")
        print(f"{'─' * 55}\n")


if __name__ == "__main__":
    main()
