from huggingface_hub import snapshot_download

# Download only the contents of the 'Banana' folder
local_snapshot_path = snapshot_download(
    repo_id="Adithyak1106/Disease-Detection-Models",
    # This targets all files specifically within the mango/ directory
    allow_patterns=["mango/*"], 
    local_dir="./Disease_Models",
    local_dir_use_symlinks=False 
)

print(f"Paddy models downloaded to: {local_snapshot_path}")