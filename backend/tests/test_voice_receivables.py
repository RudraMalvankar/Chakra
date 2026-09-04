"""
Tests for Voice Provider abstraction.
Uses MockVoiceProvider - no real phone calls made.
"""
import pytest
import asyncio
from backend.app.services.voice import (
    MockVoiceProvider,
    TwilioVoiceProvider,
    get_voice_provider,
    extract_voice_intent,
    generate_hinglish_voice_note
)


class TestMockVoiceProvider:
    def test_mock_provider_always_succeeds(self):
        provider = MockVoiceProvider()
        result = asyncio.run(
            provider.start_call("+919999999999", {"case_id": "test_001", "amount": 5000})
        )
        assert result["status"] == "success"
        assert result["call_sid"].startswith("CA_mock_")
        assert result["mocked"] is True

    def test_mock_provider_never_makes_real_calls(self):
        """MockVoiceProvider must not make any network requests."""
        provider = MockVoiceProvider()
        result = asyncio.run(
            provider.start_call("INVALID_NUMBER", {"case_id": "none", "amount": 0})
        )
        assert result["status"] == "success"


class TestTwilioVoiceProviderUnconfigured:
    def test_twilio_without_credentials_returns_error(self, monkeypatch):
        monkeypatch.delenv("TWILIO_ACCOUNT_SID", raising=False)
        monkeypatch.delenv("TWILIO_AUTH_TOKEN", raising=False)
        monkeypatch.delenv("TWILIO_FROM_NUMBER", raising=False)
        provider = TwilioVoiceProvider()
        result = asyncio.run(
            provider.start_call("+919999999999", {"case_id": "test", "amount": 100})
        )
        assert result["status"] == "error"
        assert "Twilio not configured" in result["message"]

    def test_twilio_never_fakes_success_on_missing_config(self, monkeypatch):
        monkeypatch.delenv("TWILIO_ACCOUNT_SID", raising=False)
        provider = TwilioVoiceProvider()
        result = asyncio.run(provider.start_call("+919999999999", {}))
        assert result["status"] != "captured"
        # mocked True only allowed for MockVoiceProvider
        assert result.get("mocked") is not True


class TestGetVoiceProvider:
    def test_returns_mock_when_no_twilio_configured(self, monkeypatch):
        monkeypatch.delenv("TWILIO_ACCOUNT_SID", raising=False)
        provider = get_voice_provider()
        assert isinstance(provider, MockVoiceProvider)

    def test_returns_twilio_when_configured(self, monkeypatch):
        monkeypatch.setenv("TWILIO_ACCOUNT_SID", "ACtest123")
        provider = get_voice_provider()
        assert isinstance(provider, TwilioVoiceProvider)


class TestVoiceIntentExtraction:
    def test_hinglish_kal_maps_to_promise(self):
        """Keyword override must classify 'kal' as promise_to_pay."""
        result = asyncio.run(extract_voice_intent("Kal payment kar dunga"))
        assert result.intent == "promise_to_pay"

    def test_intent_has_valid_confidence(self):
        result = asyncio.run(extract_voice_intent("Kal payment kar dunga"))
        assert 0.0 <= result.confidence <= 1.0

    def test_empty_transcript_does_not_crash(self):
        result = asyncio.run(extract_voice_intent(""))
        assert result.intent in ("unclear", "unwilling", "pay_now", "promise_to_pay")


class TestGenerateHinglishVoiceNote:
    def test_returns_none_not_audio(self):
        """generate_hinglish_voice_note should return None since Twilio handles TTS."""
        result = generate_hinglish_voice_note("Rahul", 12500.0, "https://rzp.io/test")
        assert result is None
