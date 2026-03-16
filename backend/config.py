import os
import logging
from dotenv import load_dotenv

load_dotenv()

# ── Secret Manager (try GCP first, fallback to .env) ──
def _get_secret(secret_id: str, fallback_env: str) -> str:
    """Load a secret from GCP Secret Manager, falling back to env var."""
    env_val = os.getenv(fallback_env, "")
    project = os.getenv("GCP_PROJECT_ID", "")
    if not project:
        return env_val
    try:
        from google.cloud.secretmanager import SecretManagerServiceClient
        client = SecretManagerServiceClient()
        name = f"projects/{project}/secrets/{secret_id}/versions/latest"
        response = client.access_secret_version(request={"name": name})
        val = response.payload.data.decode("UTF-8").strip()
        logging.info(f"Loaded {secret_id} from Secret Manager")
        return val
    except Exception:
        logging.info(f"Secret Manager unavailable for {secret_id}, using .env")
        return env_val

GOOGLE_API_KEY = _get_secret("google-api-key", "GOOGLE_API_KEY")
# Optional overrides (useful for debugging model availability)
AUDIO_MODEL = os.getenv("AUDIO_MODEL", "")
GCP_PROJECT_ID = os.getenv("GCP_PROJECT_ID", "")
GCP_REGION = os.getenv("GCP_REGION", "us-central1")
FIRESTORE_COLLECTION = os.getenv("FIRESTORE_COLLECTION", "sessions")
FIRESTORE_DATABASE = os.getenv("FIRESTORE_DATABASE", "tutor")
GCS_BUCKET = os.getenv("GCS_BUCKET", f"{GCP_PROJECT_ID}-mathboard" if GCP_PROJECT_ID else "mathboard-exports")
