import pytest
from unittest.mock import patch, MagicMock, AsyncMock
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.config import settings
from backend.app.services.voice import VoiceIntent, get_voice_provider, TwilioVoiceProvider, MockVoiceProvider

client = TestClient(app)

@pytest.fixture
def mock_twilio_settings():
    original_sid = settings.twilio_account_sid
    original_token = settings.twilio_auth_token
    original_number = settings.twilio_from_number
    original_webhook = settings.twilio_webhook_base_url
    
    settings.twilio_account_sid = "AC_test"
    settings.twilio_auth_token = "auth_test"
    settings.twilio_from_number = "+1234567890"
    settings.twilio_webhook_base_url = "https://test.ngrok.app"
    
    yield
    
    settings.twilio_account_sid = original_sid
    settings.twilio_auth_token = original_token
    settings.twilio_from_number = original_number
    settings.twilio_webhook_base_url = original_webhook

def test_twilio_not_configured():
    # Ensure it's not configured
    original = settings.twilio_account_sid
    settings.twilio_account_sid = None
    
    res = client.post("/api/voice/recovery/start", json={
        "case_id": "case_1", "to_number": "+919999999999", "amount": 5000.0
    })
    
    # Wait, mock voice might be enabled
    if not settings.use_mock_voice:
        assert res.status_code == 400
        assert res.json()["detail"]["code"] == "TWILIO_NOT_CONFIGURED"
        
    settings.twilio_account_sid = original

def test_twilio_configured_start_call_success(mock_twilio_settings):
    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value.status_code = 201
        from unittest.mock import MagicMock
        mock_post.return_value.json = MagicMock(return_value={"sid": "CA_test_sid_123"})
        
        res = client.post("/api/voice/recovery/start", json={
            "case_id": "case_1", "to_number": "+919999999999", "amount": 5000.0
        })
        
        assert res.status_code == 200
        assert res.json()["call_sid"] == "CA_test_sid_123"
        assert res.json()["provider"] == "twilio"

def test_twilio_configured_start_call_failure(mock_twilio_settings):
    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value.status_code = 400
        mock_post.return_value.text = "Bad request"
        
        res = client.post("/api/voice/recovery/start", json={
            "case_id": "case_1", "to_number": "+919999999999", "amount": 5000.0
        })
        
        assert res.status_code == 400
        assert "TWILIO_NOT_CONFIGURED" in res.json()["detail"]["code"] or res.json()["detail"]["message"] == "Bad request"

def test_twilio_gather_promise_to_pay(mock_twilio_settings):
    with patch("backend.app.api.webhooks.extract_voice_intent", new_callable=AsyncMock) as mock_intent, \
         patch("backend.app.api.webhooks.verify_twilio_signature", return_value=True) as mock_sig, \
         patch("backend.app.api.webhooks.DBService") as mock_db, \
         patch("backend.app.api.webhooks.execute_recovery_pipeline", new_callable=AsyncMock) as mock_exec:
         
        mock_intent.return_value = VoiceIntent(
            intent="promise_to_pay",
            amount=5000.0,
            promised_date="2026-10-10",
            confidence=0.95,
            ai_used=True
        )
        
        res = client.post("/webhooks/twilio/gather?case_id=case_1&amount=5000", data={
            "SpeechResult": "Monday ko 5000 de dunga",
            "CallSid": "CA_123"
        })
        
        assert res.status_code == 200
        assert "promise note kar raha hoon" in res.text or "Humne aapka promise record kar liya" in res.text or "Maaf kijiye" in res.text

def test_twilio_gather_dispute(mock_twilio_settings):
    with patch("backend.app.api.webhooks.extract_voice_intent", new_callable=AsyncMock) as mock_intent, \
         patch("backend.app.api.webhooks.verify_twilio_signature", return_value=True) as mock_sig, \
         patch("backend.app.api.webhooks.DBService") as mock_db:
         
        mock_intent.return_value = VoiceIntent(
            intent="dispute",
            confidence=0.9,
            ai_used=True
        )
        
        res = client.post("/webhooks/twilio/gather?case_id=case_1&amount=5000", data={
            "SpeechResult": "Ye mera invoice nahi hai",
            "CallSid": "CA_123"
        })
        
        assert res.status_code == 200
        assert "review ke liye team ko forward karta hoon" in res.text
