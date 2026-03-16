"""
Google Cloud Text-to-Speech via REST API.
Uses the existing GOOGLE_API_KEY — no additional dependencies required.
"""

import asyncio
import json
import logging
import urllib.request
import urllib.error

import config as cfg

logger = logging.getLogger("mathboard.tts")

TTS_ENDPOINT = "https://texttospeech.googleapis.com/v1/text:synthesize"

# Natural-sounding voice for tutoring
VOICE_CONFIG = {
    "languageCode": "en-US",
    "name": "en-US-Neural2-C",  # Female, clear, natural
}
AUDIO_CONFIG = {
    "audioEncoding": "MP3",
    "speakingRate": 1.05,
    "pitch": 0.0,
}


def _synthesize_sync(text: str) -> str | None:
    """Synchronous TTS call — run via asyncio.to_thread()."""
    api_key = cfg.GOOGLE_API_KEY
    if not api_key:
        logger.warning("[TTS] No GOOGLE_API_KEY — skipping synthesis")
        return None

    # Truncate very long text (TTS has a 5000 byte limit)
    if len(text) > 4000:
        text = text[:4000] + "..."

    body = json.dumps({
        "input": {"text": text},
        "voice": VOICE_CONFIG,
        "audioConfig": AUDIO_CONFIG,
    }).encode("utf-8")

    url = f"{TTS_ENDPOINT}?key={api_key}"
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("audioContent")  # base64-encoded MP3
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8", errors="replace")
        logger.error(f"[TTS] HTTP {e.code}: {error_body[:200]}")
        return None
    except Exception as e:
        logger.error(f"[TTS] Error: {e}")
        return None


async def synthesize(text: str) -> str | None:
    """Async wrapper: returns base64 MP3 audio or None on failure."""
    return await asyncio.to_thread(_synthesize_sync, text)
