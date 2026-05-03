"""
Corn Leaf Disease Prediction Script
Uses a fine-tuned ResNet18 model to classify corn leaf images into:
  0: Blight
  1: Common_Rust
  2: Gray_Leaf_Spot
  3: Healthy
"""

import json
import argparse
from pathlib import Path

import torch
import torch.nn.functional as F
from torch import nn
from torchvision import models, transforms
from PIL import Image


# ── Constants ────────────────────────────────────────────────────────────────

LABELS_PATH = "corn_labels.json"   # path to the class-label JSON file
IMG_SIZE    = 256                  # must match training resolution

# ImageNet normalisation used during training
MEAN = [0.485, 0.456, 0.406]
STD  = [0.229, 0.224, 0.225]


# ── Helpers ───────────────────────────────────────────────────────────────────

def load_labels(path: str) -> dict:
    """Load the {index: class_name} mapping from JSON."""
    with open(path, "r") as f:
        raw = json.load(f)
    return {int(k): v for k, v in raw.items()}


def build_model(num_classes: int, device: torch.device) -> nn.Module:
    """Recreate the same ResNet18 architecture used during training."""
    model = models.resnet18(weights=None)               # no pretrained weights
    model.fc = nn.Linear(in_features=512, out_features=num_classes)
    model = model.to(device)
    return model


def load_model(model_path: str, num_classes: int, device: torch.device) -> nn.Module:
    """Load model weights from a .pth checkpoint."""
    model = build_model(num_classes, device)
    state_dict = torch.load(model_path, map_location=device)
    model.load_state_dict(state_dict)
    model.eval()
    print(f"✓ Model loaded from '{model_path}'")
    return model


def get_transform() -> transforms.Compose:
    """Return the same inference transform used on the test set during training."""
    return transforms.Compose([
        transforms.Resize((IMG_SIZE, IMG_SIZE)),
        transforms.ToTensor(),
        transforms.Normalize(mean=MEAN, std=STD),
    ])


def predict_single(image_path: str, model: nn.Module,
                   labels: dict, device: torch.device) -> dict:
    """
    Run inference on a single image file.

    Returns a dict with:
        - predicted_class : str   — class name
        - predicted_index : int   — class index
        - confidence      : float — probability of top class (0–1)
        - probabilities   : dict  — {class_name: probability} for all classes
    """
    transform = get_transform()

    img = Image.open(image_path).convert("RGB")
    tensor = transform(img).unsqueeze(0).to(device)   # [1, 3, H, W]

    with torch.no_grad():
        logits = model(tensor)                        # [1, num_classes]
        probs  = F.softmax(logits, dim=1).squeeze()   # [num_classes]

    top_idx  = int(torch.argmax(probs).item())
    top_prob = float(probs[top_idx].item())

    all_probs = {labels[i]: round(float(p.item()), 4)
                 for i, p in enumerate(probs)}

    return {
        "predicted_class": labels[top_idx],
        "predicted_index": top_idx,
        "confidence":      round(top_prob, 4),
        "probabilities":   all_probs,
    }


def predict_batch(image_dir: str, model: nn.Module,
                  labels: dict, device: torch.device) -> list[dict]:
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
        result = predict_single(str(path), model, labels, device)
        result["image"] = path.name
        results.append(result)

    return results


def print_result(result: dict) -> None:
    """Pretty-print a single prediction result."""
    print(f"\n{'─'*45}")
    if "image" in result:
        print(f"  Image       : {result['image']}")
    print(f"  Prediction  : {result['predicted_class']}")
    print(f"  Confidence  : {result['confidence']*100:.1f}%")
    print("  All probabilities:")
    for cls, prob in result["probabilities"].items():
        bar = "█" * int(prob * 20)
        print(f"    {cls:<18} {prob*100:5.1f}%  {bar}")
    print(f"{'─'*45}")


# ── CLI ───────────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Corn Leaf Disease Detector — ResNet18"
    )
    parser.add_argument(
        "--model", required=True,
        help="Path to the trained model weights file (e.g. model.pth)"
    )
    parser.add_argument(
        "--labels", default=LABELS_PATH,
        help=f"Path to class-labels JSON (default: {LABELS_PATH})"
    )

    # Mutually exclusive: single image vs directory
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--image",
        help="Path to a single image for prediction"
    )
    group.add_argument(
        "--dir",
        help="Path to a directory of images for batch prediction"
    )

    parser.add_argument(
        "--device", default="auto", choices=["auto", "cpu", "cuda"],
        help="Device to run inference on (default: auto)"
    )
    return parser.parse_args()


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    args = parse_args()

    # Device selection
    if args.device == "auto":
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    else:
        device = torch.device(args.device)
    print(f"Using device: {device}")

    # Load class labels & model
    labels = load_labels(args.labels)
    model  = load_model(args.model, num_classes=len(labels), device=device)

    # Run prediction
    if args.image:
        result = predict_single(args.image, model, labels, device)
        print_result(result)

    else:  # batch
        results = predict_batch(args.dir, model, labels, device)
        for r in results:
            print_result(r)

        # Summary
        from collections import Counter
        counts = Counter(r["predicted_class"] for r in results)
        print(f"\n{'─'*45}")
        print(f"  Batch summary  ({len(results)} images)")
        for cls, n in counts.most_common():
            print(f"    {cls:<18} {n} image(s)")
        print(f"{'─'*45}\n")


if __name__ == "__main__":
    main()
