"""Session persistence via Cloud Firestore."""

import time
import uuid
import logging
from typing import Optional

from google.cloud import firestore

import config as cfg

logger = logging.getLogger("mathboard.session")


class SessionService:
    """Saves and loads tutoring sessions in Firestore."""

    def __init__(self):
        self._db: Optional[firestore.AsyncClient] = None

    def _get_db(self) -> firestore.AsyncClient:
        if self._db is None:
            self._db = firestore.AsyncClient(project=cfg.GCP_PROJECT_ID or None)
        return self._db

    @property
    def _col(self):
        return self._get_db().collection(cfg.FIRESTORE_COLLECTION)

    async def create_session(self) -> str:
        """Create a new session document, return its ID."""
        sid = str(uuid.uuid4())[:8]
        doc = {
            "created_at": time.time(),
            "updated_at": time.time(),
            "message_count": 0,
            "status": "active",
        }
        await self._col.document(sid).set(doc)
        logger.info(f"Created session {sid}")
        return sid

    async def save_message(self, session_id: str, role: str, content: str,
                           whiteboard_cmds: list[dict] | None = None):
        """Append a message (user question or tutor action) to the session."""
        msg = {
            "role": role,
            "content": content,
            "timestamp": time.time(),
        }
        if whiteboard_cmds:
            msg["whiteboard_cmds"] = whiteboard_cmds

        msg_ref = self._col.document(session_id).collection("messages")
        await msg_ref.add(msg)
        await self._col.document(session_id).update({
            "updated_at": time.time(),
            "message_count": firestore.Increment(1),
        })

    async def end_session(self, session_id: str):
        """Mark session as ended."""
        await self._col.document(session_id).update({
            "status": "ended",
            "updated_at": time.time(),
        })
        logger.info(f"Ended session {session_id}")

    async def list_sessions(self, limit: int = 20) -> list[dict]:
        """Return recent sessions, newest first."""
        query = self._col.order_by("created_at", direction="DESCENDING").limit(limit)
        docs = []
        async for doc in query.stream():
            d = doc.to_dict()
            d["id"] = doc.id
            docs.append(d)
        return docs

    async def get_session(self, session_id: str) -> dict | None:
        """Return full session with messages."""
        doc = await self._col.document(session_id).get()
        if not doc.exists:
            return None
        data = doc.to_dict()
        data["id"] = doc.id
        # Fetch messages
        msgs = []
        msg_query = self._col.document(session_id).collection("messages").order_by("timestamp")
        async for m in msg_query.stream():
            msgs.append(m.to_dict())
        data["messages"] = msgs
        return data
