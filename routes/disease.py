"""
routes/disease.py
─────────────────
Unified disease detection pipeline. Each crop uses its exact original
prediction script logic, directly integrated.

  Banana  → Keras ensemble (LeNet + ResNet50 + InceptionV3), IMG=128
  Coffee  → PyTorch CLIP ViT (TorchScript export), IMG=224
  Corn    → PyTorch ResNet18, IMG=256, ImageNet norm
  Mango   → Keras EfficientNetB7 (weights-only), IMG=224
  Paddy   → Keras DenseNet121, IMG=256

Labels: Disease_Models/<crop>/<crop>_labels.json  {index: class_name}
"""

import io, json, logging, traceback
from pathlib import Path

import numpy as np
from PIL import Image
from flask import Blueprint, jsonify, request

disease_bp = Blueprint("disease", __name__)
logger     = logging.getLogger(__name__)

BASE_DIR        = Path("Disease_Models")
SUPPORTED_CROPS = ["banana", "coffee", "corn", "mango", "paddy"]

# ── Model cache ────────────────────────────────────────────────────────────────
_cache: dict = {}   # crop → loaded model entry


# ── Label loader ──────────────────────────────────────────────────────────────
def _load_labels(crop: str) -> dict:
    """Load {int: class_name} from <crop>_labels.json."""
    p = BASE_DIR / crop / f"{crop}_labels.json"
    if not p.exists():
        raise FileNotFoundError(f"Labels file not found: {p}")
    with open(p) as f:
        raw = json.load(f)
    # Support both list ["cls0","cls1",...] and dict {"0":"cls0",...}
    if isinstance(raw, list):
        return {i: v for i, v in enumerate(raw)}
    return {int(k): v for k, v in raw.items()}


# ═══════════════════════════════════════════════════════════════════════════════
# BANANA — Keras soft-voting ensemble (LeNet + ResNet50 + InceptionV3)
# ═══════════════════════════════════════════════════════════════════════════════
BANANA_IMG_SIZE = 128

def _patch_keras_compat():
    """Patch Keras 2→3 layer config incompatibilities (run once)."""
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

def _build_banana_resnet(num_classes):
    from tensorflow.keras.applications import ResNet50
    from tensorflow.keras.layers import GlobalAveragePooling2D, Dense, Dropout, BatchNormalization
    from tensorflow.keras.models import Sequential
    base = ResNet50(weights=None, include_top=False,
                    input_shape=(BANANA_IMG_SIZE, BANANA_IMG_SIZE, 3))
    base.trainable = False
    return Sequential([base, GlobalAveragePooling2D(),
                        Dense(128, activation='relu'), BatchNormalization(),
                        Dropout(0.5), Dense(num_classes, activation='softmax')])

def _build_banana_inception(num_classes):
    from tensorflow.keras.applications import InceptionV3
    from tensorflow.keras.layers import GlobalAveragePooling2D, Dense, Dropout, BatchNormalization
    from tensorflow.keras.models import Sequential
    base = InceptionV3(weights=None, include_top=False,
                       input_shape=(BANANA_IMG_SIZE, BANANA_IMG_SIZE, 3))
    base.trainable = False
    return Sequential([base, GlobalAveragePooling2D(),
                        Dense(128, activation='relu'), BatchNormalization(),
                        Dropout(0.5), Dense(num_classes, activation='softmax')])

def _load_single_keras(path, name, num_classes, rebuild_fn=None):
    import tensorflow as tf
    try:
        m = tf.keras.models.load_model(str(path), compile=False)
        logger.info("✓ %s loaded (full model)", name)
        return m
    except Exception as e:
        if rebuild_fn is None:
            logger.warning("✗ %s failed: %s", name, e)
            return None
    try:
        logger.info("⚠ %s: full load failed, loading weights only...", name)
        m = rebuild_fn(num_classes)
        m(np.zeros((1, BANANA_IMG_SIZE, BANANA_IMG_SIZE, 3), dtype=np.float32))
        m.load_weights(str(path))
        logger.info("✓ %s weights loaded", name)
        return m
    except Exception as e2:
        logger.warning("✗ %s weights failed: %s", name, e2)
        return None

def _load_banana():
    crop_dir   = BASE_DIR / "banana"
    labels     = _load_labels("banana")
    num_classes = len(labels)
    _patch_keras_compat()
    models = []
    for fname, name, rebuild_fn in [
        ("model_lenet.h5",     "LeNet",       None),
        ("model_resnet.h5",    "ResNet50",    _build_banana_resnet),
        ("model_inception.h5", "InceptionV3", _build_banana_inception),
    ]:
        p = crop_dir / fname
        if p.exists():
            m = _load_single_keras(p, name, num_classes, rebuild_fn)
            if m is not None:
                models.append((m, name))
    if not models:
        raise RuntimeError("No banana models could be loaded.")
    logger.info("Banana ensemble: %d model(s) loaded", len(models))
    return {"models": models, "labels": labels, "crop": "banana"}

def _predict_banana(entry, img: Image.Image) -> dict:
    labels      = entry["labels"]
    num_classes = len(labels)
    img_r       = img.convert("RGB").resize((BANANA_IMG_SIZE, BANANA_IMG_SIZE))
    arr         = np.expand_dims(np.array(img_r, dtype=np.float32) / 255.0, 0)
    all_probs   = np.zeros(num_classes, dtype=np.float32)
    per_model   = {}
    for model, name in entry["models"]:
        preds = model.predict(arr, verbose=0)[0]
        all_probs += preds
        top = int(np.argmax(preds))
        per_model[name] = {"label": labels[top], "confidence": round(float(preds[top]) * 100, 1)}
    avg     = all_probs / len(entry["models"])
    top_idx = int(np.argmax(avg))
    probs   = {labels[i]: round(float(avg[i]) * 100, 1) for i in range(num_classes)}
    return {
        "top":        labels[top_idx],
        "confidence": round(float(avg[top_idx]) * 100, 1),
        "probs":      probs,
        "meta":       f"Ensemble×{len(entry['models'])} ({', '.join(per_model.keys())})",
        "per_model":  per_model,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# COFFEE — PyTorch CLIP ViT (TorchScript export = coffee_export.pt)
# ═══════════════════════════════════════════════════════════════════════════════
COFFEE_CLIP_BASE = "openai/clip-vit-base-patch16"

def _load_coffee():
    import torch
    crop_dir = BASE_DIR / "coffee"
    labels   = _load_labels("coffee")
    device   = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    # Prefer TorchScript export (no HuggingFace download needed)
    export_path = crop_dir / "coffee_export.pt"
    modal_path  = crop_dir / "coffee_modal.pth"

    if export_path.exists():
        model = torch.jit.load(str(export_path), map_location=device)
        model.eval()
        logger.info("✓ Coffee: TorchScript export loaded (%s)", export_path.name)
        mode = "exported"
    elif modal_path.exists():
        # Rebuild CLIPClassifier + load weights
        from transformers import CLIPModel
        import torch.nn as nn
        class CLIPClassifier(nn.Module):
            def __init__(self, num_classes):
                super().__init__()
                self.clip = CLIPModel.from_pretrained(COFFEE_CLIP_BASE)
                self.fc   = nn.Linear(1024, num_classes)
            def forward(self, pixel_values, input_ids, attention_mask):
                vision_out     = self.clip.vision_model(pixel_values=pixel_values)
                image_features = self.clip.visual_projection(vision_out.pooler_output)
                text_out       = self.clip.text_model(input_ids=input_ids,
                                                       attention_mask=attention_mask)
                text_features  = self.clip.text_projection(text_out.pooler_output)
                return self.fc(torch.cat([image_features, text_features], dim=-1))

        model = CLIPClassifier(len(labels))
        ckpt  = torch.load(str(modal_path), map_location=device, weights_only=False)
        state = ckpt.get("model_state_dict") or ckpt.get("state_dict") or ckpt
        model.load_state_dict(state)
        model.to(device).eval()
        logger.info("✓ Coffee: CLIPClassifier weights loaded (%s)", modal_path.name)
        mode = "standard"
    else:
        raise FileNotFoundError("Coffee model not found (coffee_export.pt or coffee_modal.pth)")

    from transformers import CLIPProcessor
    processor = CLIPProcessor.from_pretrained(COFFEE_CLIP_BASE)
    return {"model": model, "labels": labels, "device": device,
            "processor": processor, "mode": mode, "crop": "coffee"}

def _predict_coffee(entry, img: Image.Image) -> dict:
    import torch
    labels    = entry["labels"]
    device    = entry["device"]
    processor = entry["processor"]
    model     = entry["model"]
    num_classes = len(labels)

    texts  = [f"a photo of a {v} coffee leaf" for v in labels.values()]
    inputs = processor(images=img.convert("RGB"), text=texts,
                       return_tensors="pt", padding=True)
    pv   = inputs["pixel_values"].to(device)
    ids  = inputs["input_ids"].to(device)
    mask = inputs["attention_mask"].to(device)

    scores = []
    is_exported = isinstance(model, torch.jit.ScriptModule)
    with torch.no_grad():
        if is_exported:
            for i in range(num_classes):
                logit = model(pv, ids[i].unsqueeze(0), mask[i].unsqueeze(0))
                scores.append(logit[0, i].item())
        else:
            vision_out     = model.clip.vision_model(pixel_values=pv)
            image_features = model.clip.visual_projection(vision_out.pooler_output)
            for i in range(num_classes):
                text_out      = model.clip.text_model(input_ids=ids[i].unsqueeze(0),
                                                       attention_mask=mask[i].unsqueeze(0))
                text_features = model.clip.text_projection(text_out.pooler_output)
                combined      = torch.cat([image_features, text_features], dim=-1)
                scores.append(model.fc(combined)[0, i].item())

    probs_t = torch.softmax(torch.tensor(scores), dim=0)
    top_idx = int(torch.argmax(probs_t).item())
    probs   = {labels[i]: round(float(probs_t[i].item()) * 100, 1) for i in range(num_classes)}
    return {
        "top":        labels[top_idx],
        "confidence": round(float(probs_t[top_idx].item()) * 100, 1),
        "probs":      probs,
        "meta":       f"CLIP ViT ({entry['mode']})",
    }


# ═══════════════════════════════════════════════════════════════════════════════
# CORN — PyTorch ResNet18, IMG=256, ImageNet norm
# ═══════════════════════════════════════════════════════════════════════════════
CORN_IMG_SIZE = 256
CORN_MEAN = [0.485, 0.456, 0.406]
CORN_STD  = [0.229, 0.224, 0.225]

def _load_corn():
    import torch
    from torchvision import models
    import torch.nn as nn
    crop_dir = BASE_DIR / "corn"
    labels   = _load_labels("corn")
    device   = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    path     = crop_dir / "model.pth"
    if not path.exists():
        raise FileNotFoundError(f"Corn model not found: {path}")
    model = models.resnet18(weights=None)
    model.fc = nn.Linear(512, len(labels))
    state = torch.load(str(path), map_location=device, weights_only=True)
    model.load_state_dict(state)
    model.to(device).eval()
    logger.info("✓ Corn: ResNet18 loaded")
    return {"model": model, "labels": labels, "device": device, "crop": "corn"}

def _predict_corn(entry, img: Image.Image) -> dict:
    import torch
    import torch.nn.functional as F
    from torchvision import transforms
    labels  = entry["labels"]
    device  = entry["device"]
    tf = transforms.Compose([
        transforms.Resize((CORN_IMG_SIZE, CORN_IMG_SIZE)),
        transforms.ToTensor(),
        transforms.Normalize(mean=CORN_MEAN, std=CORN_STD),
    ])
    tensor = tf(img.convert("RGB")).unsqueeze(0).to(device)
    with torch.no_grad():
        probs = F.softmax(entry["model"](tensor), dim=1).squeeze()
    top_idx = int(torch.argmax(probs).item())
    probs_d = {labels[i]: round(float(probs[i].item()) * 100, 1) for i in range(len(labels))}
    return {
        "top":        labels[top_idx],
        "confidence": round(float(probs[top_idx].item()) * 100, 1),
        "probs":      probs_d,
        "meta":       "ResNet18",
    }


# ═══════════════════════════════════════════════════════════════════════════════
# MANGO — Keras EfficientNetB7 (weights-only .h5), IMG=224
# ═══════════════════════════════════════════════════════════════════════════════
MANGO_IMG_SIZE = 224

def _build_mango_model(num_classes):
    import tensorflow as tf
    from tensorflow.keras.models import Sequential
    from tensorflow.keras.layers import Dense, Dropout, BatchNormalization
    from tensorflow.keras import regularizers
    base = tf.keras.applications.efficientnet.EfficientNetB7(
        include_top=False, weights=None,
        input_shape=(MANGO_IMG_SIZE, MANGO_IMG_SIZE, 3), pooling='max')
    base.trainable = False
    return Sequential([
        base,
        BatchNormalization(axis=-1, momentum=0.99, epsilon=0.001),
        Dense(128, kernel_regularizer=regularizers.l2(0.016),
              activity_regularizer=regularizers.l1(0.006),
              bias_regularizer=regularizers.l1(0.006), activation='relu'),
        Dropout(rate=0.45, seed=123),
        Dense(num_classes, activation='softmax'),
    ])

def _load_mango():
    import tensorflow as tf
    _patch_keras_compat()
    crop_dir    = BASE_DIR / "mango"
    labels      = _load_labels("mango")
    num_classes = len(labels)
    path        = crop_dir / "my_model_weights.h5"
    if not path.exists():
        raise FileNotFoundError(f"Mango model not found: {path}")
    # Try full model load first, fall back to weights-only
    try:
        model = tf.keras.models.load_model(str(path), compile=False)
        logger.info("✓ Mango: full model loaded")
    except Exception:
        logger.info("⚠ Mango: rebuilding EfficientNetB7 + loading weights...")
        model = _build_mango_model(num_classes)
        model(np.zeros((1, MANGO_IMG_SIZE, MANGO_IMG_SIZE, 3), dtype=np.float32))
        model.load_weights(str(path))
        logger.info("✓ Mango: weights loaded")
    return {"model": model, "labels": labels, "crop": "mango"}

def _predict_mango(entry, img: Image.Image) -> dict:
    from tensorflow.keras.applications.efficientnet import preprocess_input
    labels = entry["labels"]
    img_r  = img.convert("RGB").resize((MANGO_IMG_SIZE, MANGO_IMG_SIZE))
    arr    = preprocess_input(np.array(img_r, dtype=np.float32))
    arr    = np.expand_dims(arr, 0)
    preds  = entry["model"].predict(arr, verbose=0)[0]
    top_idx = int(np.argmax(preds))
    probs   = {labels[i]: round(float(preds[i]) * 100, 1) for i in range(len(labels))}
    return {
        "top":        labels[top_idx],
        "confidence": round(float(preds[top_idx]) * 100, 1),
        "probs":      probs,
        "meta":       "EfficientNetB7",
    }


# ═══════════════════════════════════════════════════════════════════════════════
# PADDY — Keras DenseNet121, IMG=256
# ═══════════════════════════════════════════════════════════════════════════════
PADDY_IMG_SIZE = 256

def _build_paddy_model(num_classes):
    import tensorflow as tf
    from tensorflow.keras.applications import DenseNet121
    from tensorflow.keras.layers import BatchNormalization, Dropout, Dense
    from tensorflow.keras.models import Sequential
    base = DenseNet121(weights=None, include_top=False,
                       input_shape=(PADDY_IMG_SIZE, PADDY_IMG_SIZE, 3), pooling='avg')
    base.trainable = False
    return Sequential([
        base, BatchNormalization(), Dropout(0.35),
        Dense(220, activation='relu'),
        Dense(num_classes, activation='softmax'),
    ])

def _load_paddy():
    import tensorflow as tf
    _patch_keras_compat()
    crop_dir    = BASE_DIR / "paddy"
    labels      = _load_labels("paddy")
    num_classes = len(labels)
    path        = crop_dir / "paddy_disease_densenet121.h5"
    if not path.exists():
        raise FileNotFoundError(f"Paddy model not found: {path}")
    try:
        model = tf.keras.models.load_model(str(path), compile=False)
        logger.info("✓ Paddy: full model loaded")
    except ValueError:
        logger.info("⚠ Paddy: rebuilding DenseNet121 + loading weights...")
        model = _build_paddy_model(num_classes)
        model(np.zeros((1, PADDY_IMG_SIZE, PADDY_IMG_SIZE, 3), dtype=np.float32))
        model.load_weights(str(path))
        logger.info("✓ Paddy: weights loaded")
    return {"model": model, "labels": labels, "crop": "paddy"}

def _predict_paddy(entry, img: Image.Image) -> dict:
    from tensorflow.keras.applications.densenet import preprocess_input
    labels = entry["labels"]
    img_r  = img.convert("RGB").resize((PADDY_IMG_SIZE, PADDY_IMG_SIZE))
    arr    = preprocess_input(np.array(img_r, dtype=np.float32))
    arr    = np.expand_dims(arr, 0)
    preds  = entry["model"].predict(arr, verbose=0)[0]
    top_idx = int(np.argmax(preds))
    probs   = {labels[i]: round(float(preds[i]) * 100, 1) for i in range(len(labels))}
    return {
        "top":        labels[top_idx],
        "confidence": round(float(preds[top_idx]) * 100, 1),
        "probs":      probs,
        "meta":       "DenseNet121",
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Unified loader + predictor dispatch
# ═══════════════════════════════════════════════════════════════════════════════
_LOADERS = {
    "banana": _load_banana,
    "coffee": _load_coffee,
    "corn":   _load_corn,
    "mango":  _load_mango,
    "paddy":  _load_paddy,
}
_PREDICTORS = {
    "banana": _predict_banana,
    "coffee": _predict_coffee,
    "corn":   _predict_corn,
    "mango":  _predict_mango,
    "paddy":  _predict_paddy,
}

def _get_model(crop: str) -> dict:
    if crop not in _cache:
        _cache[crop] = _LOADERS[crop]()
    return _cache[crop]

def run_inference(crop: str, img: Image.Image) -> dict:
    entry  = _get_model(crop)
    result = _PREDICTORS[crop](entry, img)
    # Normalise to top-3 predictions list
    top3 = sorted(result["probs"].items(), key=lambda x: x[1], reverse=True)[:3]
    result["predictions"] = [{"label": k, "confidence": v} for k, v in top3]
    return result


# ── Disease severity + advice ─────────────────────────────────────────────────
DISEASE_INFO = {
    # Banana
    "black sigatoka":      {"severity": "high",     "action": "Apply propiconazole fungicide. Remove and burn infected leaves."},
    "bract mosaic virus":  {"severity": "critical", "action": "No cure. Remove infected plants. Control aphid vectors."},
    "healthy":             {"severity": "none",     "action": "Plant is healthy. Continue routine monitoring."},
    "insect pest damage":  {"severity": "medium",   "action": "Apply appropriate insecticide. Use pheromone traps."},
    "moko disease":        {"severity": "critical", "action": "Destroy infected plants immediately. Disinfect tools. Quarantine field."},
    "panama disease":      {"severity": "critical", "action": "No chemical cure. Remove and destroy plants. Use resistant varieties."},
    "yellow sigatoka":     {"severity": "medium",   "action": "Apply copper-based fungicide. Prune lower leaves."},
    # Coffee
    "cercospora":  {"severity": "medium",   "action": "Apply copper-based fungicide. Remove fallen infected leaves."},
    "healthy":     {"severity": "none",     "action": "Plant is healthy. Continue routine monitoring."},
    "miner":       {"severity": "medium",   "action": "Apply systemic insecticide. Remove heavily mined leaves."},
    "phoma":       {"severity": "high",     "action": "Apply copper or mancozeb fungicide. Improve drainage."},
    "rust":        {"severity": "high",     "action": "Apply triazole or copper fungicide immediately. Prune dense canopy."},
    # Corn
    "blight":          {"severity": "high",   "action": "Apply azoxystrobin fungicide. Rotate crops next season."},
    "common_rust":     {"severity": "medium", "action": "Apply triazole fungicide early. Use resistant hybrids."},
    "gray_leaf_spot":  {"severity": "medium", "action": "Rotate crops. Apply strobilurin fungicide at first sign."},
    "healthy":         {"severity": "none",   "action": "Crop is healthy. Continue routine monitoring."},
    # Mango
    "anthracnose":     {"severity": "high",   "action": "Apply mancozeb or carbendazim. Prune for air circulation."},
    "bacterial canker":{"severity": "high",   "action": "Prune infected parts. Apply copper bactericide. Disinfect tools."},
    "cutting weevil":  {"severity": "medium", "action": "Apply contact insecticide. Remove and destroy affected shoots."},
    "die back":        {"severity": "high",   "action": "Prune 15cm below infection. Apply copper fungicide on cuts."},
    "gall midge":      {"severity": "medium", "action": "Apply systemic insecticide at bud break. Remove galled tissue."},
    "healthy":         {"severity": "none",   "action": "Tree is healthy. Maintain regular watering and nutrition."},
    "powdery mildew":  {"severity": "medium", "action": "Apply wettable sulfur or difenoconazole at early onset."},
    "sooty mould":     {"severity": "low",    "action": "Control mealybugs and scale insects. Wash leaves with soapy water."},
    # Paddy
    "bacterial_leaf_blight":   {"severity": "high",     "action": "Drain fields. Apply copper bactericide. Use resistant varieties."},
    "bacterial_leaf_streak":   {"severity": "high",     "action": "Improve drainage. Apply copper bactericide. Avoid leaf wetness."},
    "bacterial_panicle_blight":{"severity": "high",     "action": "Apply copper bactericide at heading. Avoid excess nitrogen."},
    "blast":                   {"severity": "critical", "action": "Apply tricyclazole immediately. Avoid excess nitrogen fertiliser."},
    "brown_spot":               {"severity": "medium",  "action": "Apply mancozeb or iprodione. Ensure adequate potassium nutrition."},
    "dead_heart":               {"severity": "high",    "action": "Apply carbofuran or chlorpyrifos for stem borer control."},
    "downy_mildew":             {"severity": "medium",  "action": "Apply metalaxyl or mancozeb. Improve field drainage."},
    "hispa":                    {"severity": "medium",  "action": "Apply chlorpyrifos or quinalphos. Remove affected tillers."},
    "normal":                   {"severity": "none",    "action": "Crop is healthy. Continue routine monitoring."},
    "tungro":                   {"severity": "critical","action": "No cure. Destroy infected plants. Control leafhopper vectors urgently."},
}

SEVERITY_COLOUR = {
    "none": "#13ec49", "low": "#a3e635", "medium": "#fbbf24",
    "high": "#f97316", "critical": "#ef4444", "unknown": "#7faa88",
}

def _get_disease_info(label: str) -> dict:
    key  = label.lower().strip()
    info = DISEASE_INFO.get(key) or {}
    # Auto-detect healthy
    if not info and any(w in key for w in ["healthy", "normal"]):
        info = {"severity": "none", "action": "Plant is healthy. Continue routine monitoring."}
    sev = info.get("severity", "unknown")
    return {
        "severity": sev,
        "colour":   SEVERITY_COLOUR.get(sev, "#7faa88"),
        "action":   info.get("action", "Consult an agricultural extension officer."),
    }



# ═══════════════════════════════════════════════════════════════════════════════
# Image Quality & Leaf Validation
# ═══════════════════════════════════════════════════════════════════════════════

# Minimum pixel dimensions
MIN_WIDTH  = 80
MIN_HEIGHT = 80

# ── Validation thresholds — tune these to adjust strictness ──────────────────
BLUR_THRESHOLD       = 35    # Laplacian variance below this = too blurry
                              # Lower  = more permissive (accepts moderate quality)
                              # Higher = stricter (only sharp images pass)
                              # Typical scores: very blurry<30, moderate=80-200, sharp=200+
BRIGHTNESS_MIN       = 20    # Mean pixel value below this = too dark
BRIGHTNESS_MAX       = 240   # Mean pixel value above this = overexposed

def _laplacian_var(gray: np.ndarray) -> float:
    """Fast Laplacian variance blur score — no OpenCV needed."""
    h, w = gray.shape
    # Use simple finite differences as Laplacian approximation
    dy = np.diff(gray.astype(np.float64), axis=0)
    dx = np.diff(gray.astype(np.float64), axis=1)
    return float(np.var(dy) + np.var(dx))

def validate_image(img: Image.Image) -> tuple[bool, str, dict]:
    """
    Run pre-flight checks on an uploaded image before ML inference.

    Returns:
        (ok: bool, reason: str, meta: dict)

    Reason codes:
        'ok'            — image is acceptable
        'too_small'     — below minimum resolution
        'too_dark'      — mean brightness < BRIGHTNESS_MIN (default 20)
        'overexposed'   — mean brightness > BRIGHTNESS_MAX (default 240)
        'blurry'        — Laplacian variance < BLUR_THRESHOLD (default 35)
        'not_a_leaf'    — colour profile does not match plant material
    """
    arr = np.array(img.convert("RGB"), dtype=np.float32)
    h, w = arr.shape[:2]

    meta = {
        "width": w, "height": h,
        "r": round(float(arr[:,:,0].mean()), 1),
        "g": round(float(arr[:,:,1].mean()), 1),
        "b": round(float(arr[:,:,2].mean()), 1),
    }
    brightness = (meta["r"] + meta["g"] + meta["b"]) / 3
    r, g, b = meta["r"], meta["g"], meta["b"]

    # ── Check 1: Minimum resolution ──────────────────────────────────────────
    if w < MIN_WIDTH or h < MIN_HEIGHT:
        return False, "too_small", meta

    # ── Check 2: Brightness ───────────────────────────────────────────────────
    if brightness < BRIGHTNESS_MIN:
        return False, "too_dark", meta

    if brightness > BRIGHTNESS_MAX:
        return False, "overexposed", meta

    # ── Check 3: Blur (Laplacian variance on grayscale) ───────────────────────
    gray = np.array(img.convert("L"), dtype=np.float64)
    blur_score = _laplacian_var(gray)
    meta["blur_score"] = round(blur_score, 1)
    if blur_score < BLUR_THRESHOLD:
        return False, "blurry", meta

    # ── Check 4: Plant colour profile ─────────────────────────────────────────
    # A leaf can be: green, yellow, brown, dark-green, or red-tinted (disease)
    # Reject: skin tones, blue/grey/white scenes, solid colours

    # Green leaf: G dominates over R and B
    is_green   = g > (r * 0.78) and g > (b * 1.05)

    # Yellow/orange diseased leaf: high R+G, low B
    is_yellow  = r > 90 and g > 80 and b < (min(r, g) * 0.65)

    # Brown/dry leaf: R > G > B, earthy mid-range values
    is_brown   = r > g > b and 40 < b < 130 and 60 < g < 160 and (r - b) > 25

    # Dark/waxy green leaf: low brightness but G still ≥ R and B
    is_dark_green = brightness < 110 and g >= r * 0.90 and g >= b

    # Red-tinted diseased leaf (anthracnose, some blights)
    is_red     = r > g * 1.15 and r > b * 1.4 and r > 100 and b < 120

    is_plant = is_green or is_yellow or is_brown or is_dark_green or is_red

    if not is_plant:
        return False, "not_a_leaf", meta

    return True, "ok", meta


# Human-readable messages for each rejection reason
QUALITY_MESSAGES = {
    "too_small":   "Image is too small. Use a resolution of at least 80×80 pixels.",
    "too_dark":    "Image is too dark. Move to better lighting and retake.",
    "overexposed": "Image is overexposed. Avoid direct sunlight on the lens.",
    "blurry":      "Image is too blurry. Hold the camera steady and retake.",
    "not_a_leaf":  "No plant material detected. Please upload a clear photo of a crop leaf.",
}

# ── Routes ─────────────────────────────────────────────────────────────────────

@disease_bp.route("/api/disease/analyze", methods=["POST"])
def api_analyze():
    if "image" not in request.files:
        return jsonify({"error": "No image uploaded."}), 400

    file = request.files["image"]
    crop = request.form.get("crop", "").strip().lower()

    if not crop or crop not in SUPPORTED_CROPS:
        return jsonify({"error": "Please select a valid crop.", "supported": SUPPORTED_CROPS}), 400

    try:
        img = Image.open(io.BytesIO(file.read())).convert("RGB")
    except Exception:
        return jsonify({"error": "Could not read image. Upload a valid JPG or PNG."}), 400

    # ── Pre-flight image quality + leaf validation ────────────────────────────
    ok, reason, img_meta = validate_image(img)
    if not ok:
        return jsonify({
            "error":       QUALITY_MESSAGES.get(reason, "Invalid image."),
            "reason":      reason,
            "image_meta":  img_meta,
        }), 422

    try:
        result = run_inference(crop, img)
    except FileNotFoundError as e:
        return jsonify({"error": str(e), "crop": crop}), 404
    except RuntimeError as e:
        return jsonify({"error": str(e), "crop": crop}), 503
    except Exception as e:
        logger.error("Inference error [%s]:\n%s", crop, traceback.format_exc())
        return jsonify({"error": f"Inference failed: {e}", "crop": crop}), 500

    # Attach severity info to each prediction
    predictions = [
        {**p, **_get_disease_info(p["label"])}
        for p in result["predictions"]
    ]
    top = predictions[0]

    # ── Save to database ──────────────────────────────────────────────────────
    try:
        from database import db, DiseaseHistory
        record = DiseaseHistory(
            crop       = crop,
            disease    = top["label"],
            confidence = top["confidence"],
            severity   = top["severity"],
            action     = top["action"],
            meta       = result.get("meta", ""),
        )
        db.session.add(record)
        db.session.commit()
    except Exception as db_err:
        logger.warning("DB save failed (non-fatal): %s", db_err)

    return jsonify({
        "crop":        crop,
        "top_disease": top["label"],
        "confidence":  top["confidence"],
        "severity":    top["severity"],
        "colour":      top["colour"],
        "action":      top["action"],
        "predictions": predictions,
        "meta":        result.get("meta", ""),
        "per_model":   result.get("per_model", {}),
        "manual_crop": True,
        "crop_confidence": 100.0,
    })


@disease_bp.route("/api/disease/crops", methods=["GET"])
def api_crops():
    crops = []
    for crop in SUPPORTED_CROPS:
        crop_dir = BASE_DIR / crop
        labels   = []
        try: labels = list(_load_labels(crop).values())
        except: pass

        # Check expected model files per crop
        files_map = {
            "banana": ["model_lenet.h5", "model_resnet.h5", "model_inception.h5"],
            "coffee": ["coffee_export.pt", "coffee_modal.pth"],
            "corn":   ["model.pth"],
            "mango":  ["my_model_weights.h5"],
            "paddy":  ["paddy_disease_densenet121.h5"],
        }
        models = [{"file": f, "found": (crop_dir / f).exists()}
                  for f in files_map.get(crop, [])]

        crops.append({
            "name":        crop,
            "ready":       any(m["found"] for m in models),
            "ensemble":    crop == "banana",
            "framework":   "pytorch" if crop in ("coffee", "corn") else "keras",
            "models":      models,
            "num_classes": len(labels),
        })
    return jsonify({"crops": crops})


@disease_bp.route("/api/disease/status", methods=["GET"])
def api_status():
    try: import tensorflow; tf_ok = True
    except: tf_ok = False
    try: import torch; pth_ok = True
    except: pth_ok = False
    return jsonify({
        "tensorflow": tf_ok,
        "pytorch":    pth_ok,
        "crops":      SUPPORTED_CROPS,
    })
