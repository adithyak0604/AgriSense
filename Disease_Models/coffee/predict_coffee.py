"""
Coffee Leaf Disease Prediction Script
Uses a fine-tuned CLIP (ViT) model with a custom classifier head to classify
coffee leaf images into 5 disease categories:

  0: cercospora
  1: healthy
  2: miner
  3: phoma
  4: rust
"""

import json
import argparse
from pathlib import Path

import torch
import torch.nn as nn
import numpy as np
from PIL import Image
from transformers import CLIPProcessor, CLIPModel


# ── Constants ─────────────────────────────────────────────────────────────────

LABELS_PATH  = "coffee_labels.json"
CLIP_BASE    = "openai/clip-vit-base-patch16"  # large variant used for fine-tuning
IMG_SIZE     = 224                              # resize before CLIP processor


# ── Model Definition ──────────────────────────────────────────────────────────

class CLIPClassifier(nn.Module):
    """
    Exact architecture recovered from checkpoint inspection:
      - clip-vit-base-patch16 (vision hidden=768, projection=512)
      - image_features  = visual_projection(pooler_output)  → (B, 512)
      - text_features   = text_projection(text_pooler)      → (B, 512)
      - combined        = concat([image_features, text_features])  → (B, 1024)
      - fc(1024 → num_classes)
    Confirmed by: clip.visual_projection [512,768], clip.text_projection [512,512],
                  fc.weight [5, 1024] = 512+512
    """
    def __init__(self, num_classes: int, clip_model_name: str = CLIP_BASE):
        super().__init__()
        self.clip = CLIPModel.from_pretrained(clip_model_name)
        self.fc   = nn.Linear(1024, num_classes)  # 512 img + 512 txt

    def forward(self, pixel_values: torch.Tensor,
                input_ids: torch.Tensor,
                attention_mask: torch.Tensor) -> torch.Tensor:
        # Image features: pooler_output → visual_projection → (B, 512)
        vision_out    = self.clip.vision_model(pixel_values=pixel_values)
        image_features = self.clip.visual_projection(vision_out.pooler_output)

        # Text features: last_hidden_state CLS → text_projection → (B, 512)
        text_out      = self.clip.text_model(input_ids=input_ids,
                                             attention_mask=attention_mask)
        text_features  = self.clip.text_projection(text_out.pooler_output)

        # Concatenate and classify
        combined = torch.cat([image_features, text_features], dim=-1)  # (B, 1024)
        return self.fc(combined)


# ── Helpers ───────────────────────────────────────────────────────────────────

def load_labels(path: str) -> dict:
    """Load the {index: class_name} mapping from JSON."""
    with open(path, "r") as f:
        raw = json.load(f)
    return {int(k): v for k, v in raw.items()}


def load_model(model_path: str, num_classes: int,
               clip_model_name: str, device: torch.device,
               exported: bool = False):
    """
    Load the model. Two modes:

    Fast mode (--exported flag):
      Loads a self-contained TorchScript file produced by export_coffee_model.py.
      No HuggingFace download needed — starts in seconds.

    Standard mode (default):
      Rebuilds CLIPClassifier from HuggingFace + loads saved weights.
      Requires internet on first run to download the CLIP backbone (~1.7GB).
    """
    if exported:
        model = torch.jit.load(model_path, map_location=device)
        model.to(device)
        model.eval()
        print(f"✓ Exported TorchScript model loaded from '{model_path}' (fast mode)")
        return model

    # Standard: rebuild architecture + load weights
    model = CLIPClassifier(num_classes=num_classes,
                           clip_model_name=clip_model_name)
    checkpoint = torch.load(model_path, map_location=device)
    if isinstance(checkpoint, dict):
        state_dict = (checkpoint.get("model_state_dict")
                      or checkpoint.get("state_dict")
                      or checkpoint)
    else:
        state_dict = checkpoint

    model.load_state_dict(state_dict)
    model.to(device)
    model.eval()
    print(f"✓ Model loaded from '{model_path}'")
    return model


def get_processor(clip_model_name: str = CLIP_BASE) -> CLIPProcessor:
    """Load the CLIP processor (handles resizing, normalisation, tokenisation)."""
    return CLIPProcessor.from_pretrained(clip_model_name)


def preprocess_image(image_path: str, processor: CLIPProcessor,
                     labels: dict, device: torch.device):
    """
    Load image and tokenize all class label prompts together.
    Returns pixel_values, input_ids, attention_mask — all on device.
    """
    img   = Image.open(image_path).convert("RGB")
    texts = [f"a photo of a {v} coffee leaf" for v in labels.values()]
    inputs = processor(images=img, text=texts,
                       return_tensors="pt", padding=True)
    return (inputs["pixel_values"].to(device),
            inputs["input_ids"].to(device),
            inputs["attention_mask"].to(device))


def predict_single(image_path: str, model,
                   processor: CLIPProcessor, labels: dict,
                   device: torch.device) -> dict:
    """
    Run inference on a single image file.
    Handles both:
      - Exported TorchScript model: call model(pixels, ids, mask) directly
      - Standard CLIPClassifier:    access model.clip submodules explicitly
    """
    pixel_values, input_ids, attention_mask = preprocess_image(
        image_path, processor, labels, device)

    num_classes = len(labels)
    is_exported = isinstance(model, torch.jit.ScriptModule)
    scores = []

    with torch.no_grad():
        if is_exported:
            # TorchScript model: call once per class with matching text tokens
            for i in range(num_classes):
                ids  = input_ids[i].unsqueeze(0)
                mask = attention_mask[i].unsqueeze(0)
                logit = model(pixel_values, ids, mask)   # (1, num_classes)
                scores.append(logit[0, i].item())
        else:
            # Standard model: access CLIP submodules directly
            vision_out     = model.clip.vision_model(pixel_values=pixel_values)
            image_features = model.clip.visual_projection(vision_out.pooler_output)

            for i in range(num_classes):
                ids  = input_ids[i].unsqueeze(0)
                mask = attention_mask[i].unsqueeze(0)
                text_out      = model.clip.text_model(input_ids=ids,
                                                      attention_mask=mask)
                text_features = model.clip.text_projection(text_out.pooler_output)
                combined      = torch.cat([image_features, text_features], dim=-1)
                logit         = model.fc(combined)
                scores.append(logit[0, i].item())

    probs    = torch.softmax(torch.tensor(scores), dim=0)
    top_idx  = int(torch.argmax(probs).item())
    top_prob = float(probs[top_idx].item())

    all_probs = {labels[i]: round(float(probs[i].item()), 4)
                 for i in range(num_classes)}

    return {
        "predicted_class": labels[top_idx],
        "predicted_index": top_idx,
        "confidence":      round(top_prob, 4),
        "probabilities":   all_probs,
    }


def predict_batch(image_dir: str, model: CLIPClassifier,
                  processor: CLIPProcessor, labels: dict,
                  device: torch.device) -> list:
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
        result = predict_single(str(path), model, processor, labels, device)
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
        print(f"    {cls:<15} {prob * 100:5.1f}%  {bar}")
    print(f"{'─' * 50}")


# ── CLI ───────────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Coffee Leaf Disease Detector — CLIP (HuggingFace)"
    )
    parser.add_argument(
        "--model", required=True,
        help="Path to the saved model weights file (e.g. coffee_model.pth)"
    )
    parser.add_argument(
        "--labels", default=LABELS_PATH,
        help=f"Path to class-labels JSON (default: {LABELS_PATH})"
    )
    parser.add_argument(
        "--clip_model", default=CLIP_BASE,
        help=f"HuggingFace CLIP model name (default: {CLIP_BASE})"
    )
    parser.add_argument(
        "--device", default="auto", choices=["auto", "cpu", "cuda"],
        help="Device to run inference on (default: auto)"
    )
    parser.add_argument(
        "--exported", action="store_true",
        help="Load a TorchScript exported model (from export_coffee_model.py) "
             "for fast inference with no HuggingFace download"
    )

    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--image",
        help="Path to a single image for prediction"
    )
    group.add_argument(
        "--dir",
        help="Path to a directory of images for batch prediction"
    )
    return parser.parse_args()


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    args = parse_args()

    # Device
    if args.device == "auto":
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    else:
        device = torch.device(args.device)
    print(f"Using device: {device}")

    # Load labels, processor and model
    labels    = load_labels(args.labels)
    processor = get_processor(args.clip_model)
    model     = load_model(args.model, num_classes=len(labels),
                           clip_model_name=args.clip_model, device=device,
                           exported=args.exported)

    # Predict
    if args.image:
        result = predict_single(args.image, model, processor, labels, device)
        print_result(result)

    else:  # batch
        results = predict_batch(args.dir, model, processor, labels, device)
        for r in results:
            print_result(r)

        from collections import Counter
        counts = Counter(r["predicted_class"] for r in results)
        print(f"\n{'─' * 50}")
        print(f"  Batch summary  ({len(results)} images)")
        for cls, n in counts.most_common():
            print(f"    {cls:<15} {n} image(s)")
        print(f"{'─' * 50}\n")


if __name__ == "__main__":
    main()
