"""Whiteboard state + Cloud Storage exports."""

import asyncio
import io
import logging
import time
from typing import Optional

from google.cloud import storage

import config as cfg

logger = logging.getLogger("mathboard.whiteboard")

MAX_COMMANDS_PER_SESSION = 5000
SESSION_TTL_SECONDS = 3600  # 1 hour


class WhiteboardService:
    """Tracks whiteboard state and exports to Cloud Storage."""

    def __init__(self):
        self._client: Optional[storage.Client] = None
        self._commands: dict[str, list[dict]] = {}  # session_id -> commands
        self._last_access: dict[str, float] = {}  # session_id -> timestamp
        self._lock = asyncio.Lock()
        self._cleanup_task: asyncio.Task | None = None

    def start_cleanup_loop(self):
        """Start background TTL cleanup (call once at app startup)."""
        if self._cleanup_task is None:
            self._cleanup_task = asyncio.create_task(self._ttl_cleanup())

    async def _ttl_cleanup(self):
        """Periodically remove expired sessions."""
        while True:
            await asyncio.sleep(300)  # every 5 minutes
            async with self._lock:
                now = time.time()
                expired = [
                    sid for sid, ts in self._last_access.items()
                    if now - ts > SESSION_TTL_SECONDS
                ]
                for sid in expired:
                    self._commands.pop(sid, None)
                    self._last_access.pop(sid, None)
                if expired:
                    logger.info(f"TTL cleanup: removed {len(expired)} expired session(s)")

    def _get_client(self) -> storage.Client:
        if self._client is None:
            self._client = storage.Client(project=cfg.GCP_PROJECT_ID or None)
        return self._client

    def close_client(self):
        """Close the storage client (call on app shutdown)."""
        if self._client:
            self._client.close()
            self._client = None
        if self._cleanup_task:
            self._cleanup_task.cancel()
            self._cleanup_task = None

    def _get_bucket(self):
        client = self._get_client()
        bucket = client.bucket(cfg.GCS_BUCKET)
        if not bucket.exists():
            bucket = client.create_bucket(cfg.GCS_BUCKET, location=cfg.GCP_REGION)
            logger.info(f"Created GCS bucket: {cfg.GCS_BUCKET}")
        return bucket

    async def track_command(self, session_id: str, cmd: dict):
        """Track a whiteboard command for the session."""
        async with self._lock:
            self._last_access[session_id] = time.time()
            if cmd.get("action") == "clear":
                self._commands[session_id] = []
            else:
                cmds = self._commands.setdefault(session_id, [])
                if len(cmds) >= MAX_COMMANDS_PER_SESSION:
                    logger.warning(f"Session {session_id} hit command limit ({MAX_COMMANDS_PER_SESSION})")
                    return
                cmds.append(cmd)

    async def get_commands(self, session_id: str) -> list[dict]:
        async with self._lock:
            self._last_access[session_id] = time.time()
            return list(self._commands.get(session_id, []))

    async def clear_session(self, session_id: str):
        async with self._lock:
            self._commands.pop(session_id, None)
            self._last_access.pop(session_id, None)

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
