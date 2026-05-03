from huggingface_hub import hf_hub_download

# Download a single file
file_path = hf_hub_download(
    repo_id="Adithyak1106/Disease-Detection-Models",
    filename="navarasa_emotion_model_split1.h5",
    local_dir="./"
)
print(f"File downloaded to: {file_path}")
