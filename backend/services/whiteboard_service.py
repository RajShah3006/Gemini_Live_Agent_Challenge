"""Whiteboard state + Cloud Storage exports."""

import io
import logging
import time
from typing import Optional

from google.cloud import storage

import config as cfg

logger = logging.getLogger("mathboard.whiteboard")


class WhiteboardService:
    """Tracks whiteboard state and exports to Cloud Storage."""

    def __init__(self):
        self._client: Optional[storage.Client] = None
        self._commands: dict[str, list[dict]] = {}  # session_id -> commands

    def _get_client(self) -> storage.Client:
        if self._client is None:
            self._client = storage.Client(project=cfg.GCP_PROJECT_ID or None)
        return self._client

    def _get_bucket(self):
        client = self._get_client()
        bucket = client.bucket(cfg.GCS_BUCKET)
        if not bucket.exists():
            bucket = client.create_bucket(cfg.GCS_BUCKET, location=cfg.GCP_REGION)
            logger.info(f"Created GCS bucket: {cfg.GCS_BUCKET}")
        return bucket

    def track_command(self, session_id: str, cmd: dict):
        """Track a whiteboard command for the session."""
        if cmd.get("action") == "clear":
            self._commands[session_id] = []
        else:
            self._commands.setdefault(session_id, []).append(cmd)

    def get_commands(self, session_id: str) -> list[dict]:
        return self._commands.get(session_id, [])

    def clear_session(self, session_id: str):
        if session_id in self._commands:
            del self._commands[session_id]

    def upload_export(self, session_id: str, file_bytes: bytes,
                      filename: str, content_type: str = "application/pdf") -> str:
        """Upload a whiteboard export (PDF/PNG) to GCS and return a signed URL."""
        bucket = self._get_bucket()
        ts = int(time.time())
        blob_name = f"exports/{session_id}/{ts}_{filename}"
        blob = bucket.blob(blob_name)
        blob.upload_from_file(io.BytesIO(file_bytes), content_type=content_type)
        # Generate signed URL valid for 7 days
        url = blob.generate_signed_url(expiration=7 * 24 * 3600, version="v4")
        logger.info(f"Uploaded {blob_name} ({len(file_bytes)} bytes)")
        return url

    def upload_snapshot(self, session_id: str, image_bytes: bytes) -> str:
        """Upload a whiteboard screenshot to GCS."""
        return self.upload_export(session_id, image_bytes, "snapshot.png", "image/png")
