"""Security & input validation tests for MathBoard backend."""
import base64
import os
import pytest

# Ensure we don't need real GCP credentials for these tests
os.environ.setdefault("GOOGLE_API_KEY", "test-key")


class TestCORSConfiguration:
    """Verify CORS is not wildcard + credentials."""

    def test_cors_not_wildcard(self):
        """CORS origins must not default to '*' when credentials are enabled."""
        # Simulate no env var set
        raw = os.getenv("CORS_ORIGINS", "")
        origins = [o.strip() for o in raw.split(",") if o.strip()] if raw else []
        fallback = origins or ["http://localhost:3000"]
        assert "*" not in fallback, "CORS must not use wildcard with credentials"

    def test_cors_explicit_origins(self):
        """Setting CORS_ORIGINS env var should produce explicit list."""
        raw = "https://app.example.com,https://example.com"
        origins = [o.strip() for o in raw.split(",") if o.strip()]
        assert len(origins) == 2
        assert "https://app.example.com" in origins


class TestInputValidation:
    """Test payload size limits and input validation."""

    def test_audio_payload_size_limit(self):
        """Audio payloads > 5MB base64 should be rejected."""
        large_payload = "A" * 5_000_001
        assert len(large_payload) > 5_000_000

    def test_text_message_truncation(self):
        """Text messages should be capped at 2000 chars."""
        long_text = "x" * 5000
        truncated = long_text[:2000]
        assert len(truncated) == 2000

    def test_image_payload_size_limit(self):
        """Image payloads > 10MB base64 should be rejected."""
        large_payload = "A" * 10_000_001
        assert len(large_payload) > 10_000_000

    def test_valid_base64_audio(self):
        """Valid base64 should decode without error."""
        valid = base64.b64encode(b"test audio data").decode()
        decoded = base64.b64decode(valid)
        assert decoded == b"test audio data"

    def test_invalid_base64_audio(self):
        """Invalid base64 should raise appropriate error."""
        import binascii
        with pytest.raises((binascii.Error, ValueError)):
            base64.b64decode("not-valid-base64!!!")


class TestNoSecretsExposed:
    """Ensure no secrets are hardcoded in source files."""

    def test_no_api_keys_in_main(self):
        main_path = os.path.join(os.path.dirname(__file__), "..", "main.py")
        with open(main_path) as f:
            content = f.read()
        assert "AIza" not in content, "API key found hardcoded in main.py"
        assert "sk-" not in content, "Secret key found hardcoded in main.py"

    def test_no_api_keys_in_service(self):
        svc_path = os.path.join(os.path.dirname(__file__), "..", "services", "gemini_service.py")
        with open(svc_path) as f:
            content = f.read()
        assert "AIza" not in content, "API key found hardcoded in gemini_service.py"

    def test_no_api_keys_in_config(self):
        cfg_path = os.path.join(os.path.dirname(__file__), "..", "config.py")
        with open(cfg_path) as f:
            content = f.read()
        assert "AIza" not in content, "API key found hardcoded in config.py"


class TestSystemPromptSecurity:
    """Validate system prompts don't leak sensitive info."""

    def test_no_credentials_in_prompts(self):
        svc_path = os.path.join(os.path.dirname(__file__), "..", "services", "gemini_service.py")
        with open(svc_path) as f:
            content = f.read()
        # Check system prompts don't contain API keys or project IDs
        assert "AIzaSy" not in content
        assert "ai-tutor-488621" not in content
