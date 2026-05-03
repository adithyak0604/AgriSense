from huggingface_hub import snapshot_download

# Download only the contents of the 'Banana' folder
local_snapshot_path = snapshot_download(
    repo_id="Adithyak1106/Crop-Recommendation-Model",
    # This targets all files specifically within the Crop-Recommendation-Model Repo
    allow_patterns=["/*"], 
    local_dir="./Rec_Models",
    local_dir_use_symlinks=False 
)

print(f"Recommendation models downloaded to: {local_snapshot_path}")
