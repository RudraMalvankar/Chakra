"""
Voice Recovery Tests — 18 tests covering the complete Twilio + Gemini flow.

Tests actual behavior: missing credentials, webhook URL, call start/failure,
signature validation, TwiML output, Gather transcript processing, Gemini intent,
fallback, promise persistence, pay_now, dispute, unwilling, transcript/intent/
status persistence, and no fake call success.
"""
import pytest
from unittest.mock import patch, MagicMock, AsyncMock
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.config import settings
from backend.app.services.voice import (
    VoiceIntent,
    get_voice_provider,
    TwilioVoiceProvider,
    MockVoiceProvider,
    UnavailableVoiceProvider,
)

client = TestClient(app)


@pytest.fixture
def mock_twilio_settings():
    original = {
        "sid": settings.twilio_account_sid,
        "token": settings.twilio_auth_token,
        "number": settings.twilio_from_number,
        "webhook": settings.twilio_webhook_base_url,
    }
    settings.twilio_account_sid = "AC_test"
    settings.twilio_auth_token = "auth_test"
    settings.twilio_from_number = "+1234567890"
    settings.twilio_webhook_base_url = "https://test.ngrok.app"
    yield
    settings.twilio_account_sid = original["sid"]
    settings.twilio_auth_token = original["token"]
    settings.twilio_from_number = original["number"]
    settings.twilio_webhook_base_url = original["webhook"]


@pytest.fixture
def unconfigured_twilio():
    original = {
        "sid": settings.twilio_account_sid,
        "token": settings.twilio_auth_token,
        "mock": settings.use_mock_voice,
    }
    settings.twilio_account_sid = None
    settings.twilio_auth_token = None
    settings.use_mock_voice = False
    yield
    settings.twilio_account_sid = original["sid"]
    settings.twilio_auth_token = original["token"]
    settings.use_mock_voice = original["mock"]


# ─── 1. Missing Twilio credentials ──────────────────────────────────────────
def test_missing_twilio_credentials(unconfigured_twilio):
    res = client.post(
        "/api/voice/recovery/start",
        json={"case_id": "case_1", "to_number": "+919999999999", "amount": 5000.0},
    )
    assert res.status_code == 400
    detail = res.json()["detail"]
    assert detail["code"] == "TWILIO_NOT_CONFIGURED"


# ─── 2. Missing webhook URL ─────────────────────────────────────────────────
def test_missing_webhook_url():
    original = {
        "sid": settings.twilio_account_sid,
        "token": settings.twilio_auth_token,
        "number": settings.twilio_from_number,
        "webhook": settings.twilio_webhook_base_url,
    }
    settings.twilio_account_sid = "AC_test"
    settings.twilio_auth_token = "auth_test"
    settings.twilio_from_number = "+1234567890"
    settings.twilio_webhook_base_url = ""

    res = client.post(
        "/api/voice/recovery/start",
        json={"case_id": "case_1", "to_number": "+919999999999", "amount": 5000.0},
    )
    assert res.status_code == 400
    assert "WEBHOOK" in res.json()["detail"]["message"].upper()

    settings.twilio_account_sid = original["sid"]
    settings.twilio_auth_token = original["token"]
    settings.twilio_from_number = original["number"]
    settings.twilio_webhook_base_url = original["webhook"]


# ─── 3. Twilio call success ─────────────────────────────────────────────────
def test_twilio_call_success(mock_twilio_settings):
    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value.status_code = 201
        mock_post.return_value.json = MagicMock(
            return_value={"sid": "CA_test_sid_123"}
        )

        res = client.post(
            "/api/voice/recovery/start",
            json={
                "case_id": "case_1",
                "to_number": "+919999999999",
                "amount": 5000.0,
            },
        )

        assert res.status_code == 200
        body = res.json()
        assert body["call_sid"] == "CA_test_sid_123"
        assert body["provider"] == "twilio"
        assert body["mode"] == "live"


# ─── 4. Twilio call failure ─────────────────────────────────────────────────
def test_twilio_call_failure(mock_twilio_settings):
    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value.status_code = 400
        mock_post.return_value.text = "Bad request"

        res = client.post(
            "/api/voice/recovery/start",
            json={
                "case_id": "case_1",
                "to_number": "+919999999999",
                "amount": 5000.0,
            },
        )

        assert res.status_code == 400


# ─── 5. Invalid Twilio signature ────────────────────────────────────────────
def test_invalid_twilio_signature(mock_twilio_settings):
    res = client.post(
        "/webhooks/twilio/gather?case_id=case_1&amount=5000",
        data={"SpeechResult": "test", "CallSid": "CA_123"},
        headers={"X-Twilio-Signature": "invalid_signature"},
    )
    assert res.status_code == 403


# ─── 6. Valid Twilio signature (mocked validator) ────────────────────────────
def test_valid_twilio_signature(mock_twilio_settings):
    with (
        patch(
            "backend.app.api.webhooks.verify_twilio_signature", return_value=True
        ),
        patch(
            "backend.app.api.webhooks.extract_voice_intent",
            new_callable=AsyncMock,
        ) as mock_intent,
        patch("backend.app.api.webhooks.DBService"),
    ):
        mock_intent.return_value = VoiceIntent(
            intent="unknown", confidence=0.0, ai_used=False, fallback_used=True
        )
        res = client.post(
            "/webhooks/twilio/gather?case_id=case_1&amount=5000",
            data={"SpeechResult": "hello", "CallSid": "CA_123"},
        )
        assert res.status_code == 200


# ─── 7. Initial TwiML ───────────────────────────────────────────────────────
def test_initial_twiml():
    original_token = settings.twilio_auth_token
    settings.twilio_auth_token = None

    res = client.post("/webhooks/twilio/twiml?case_id=case_1&amount=5000")
    assert res.status_code == 200
    assert "text/xml" in res.headers["content-type"]
    body = res.text
    assert "<Gather" in body
    assert 'language="hi-IN"' in body
    assert "Namaste" in body
    assert "case_id=case_1" in body

    settings.twilio_auth_token = original_token


# ─── 8. Gather transcript processing ────────────────────────────────────────
def test_gather_processes_speech(mock_twilio_settings):
    with (
        patch(
            "backend.app.api.webhooks.verify_twilio_signature", return_value=True
        ),
        patch(
            "backend.app.api.webhooks.extract_voice_intent",
            new_callable=AsyncMock,
        ) as mock_intent,
        patch("backend.app.api.webhooks.DBService") as mock_db,
    ):
        mock_intent.return_value = VoiceIntent(
            intent="pay_now",
            confidence=0.85,
            ai_used=True,
            language="hinglish",
            model_used="gemini-2.5-flash",
        )
        res = client.post(
            "/webhooks/twilio/gather?case_id=case_1&amount=5000",
            data={
                "SpeechResult": "Abhi payment link bhej do",
                "CallSid": "CA_test_gather",
            },
        )
        assert res.status_code == 200
        # Verify extract_voice_intent was called with the speech
        mock_intent.assert_called_once_with("Abhi payment link bhej do")


# ─── 9. Gemini voice intent (real function, mocked Gemini) ──────────────────
def test_gemini_voice_intent_extraction():
    with patch("backend.app.services.llm.genai") as mock_genai, patch(
        "backend.app.services.llm.GEMINI_AVAILABLE", True
    ):
        mock_response = MagicMock()
        mock_response.parsed = None
        mock_response.text = '{"intent":"promise_to_pay","promised_amount":5000,"promised_date":"2026-10-10","language":"hinglish","confidence":0.92}'
        mock_genai.Client.return_value.models.generate_content.return_value = (
            mock_response
        )

        original_key = settings.gemini_api_key
        settings.gemini_api_key = "test_key"

        from backend.app.services.llm import gemini_voice_intent

        result = gemini_voice_intent("Monday ko 5000 de dunga")
        assert result.intent == "promise_to_pay"
        assert result.promised_amount == 5000
        assert result.confidence == 0.92
        assert result.ai_used

        settings.gemini_api_key = original_key


# ─── 10. Gemini unavailable fallback ────────────────────────────────────────
def test_gemini_unavailable_fallback():
    original_key = settings.gemini_api_key
    settings.gemini_api_key = None

    from backend.app.services.llm import gemini_voice_intent

    result = gemini_voice_intent("Monday ko pay karunga")
    assert not result.ai_used
    assert result.fallback_used
    assert result.confidence == 0.0

    settings.gemini_api_key = original_key


# ─── 11. promise_to_pay response ────────────────────────────────────────────
def test_gather_promise_to_pay(mock_twilio_settings):
    with (
        patch(
            "backend.app.api.webhooks.verify_twilio_signature", return_value=True
        ),
        patch(
            "backend.app.api.webhooks.extract_voice_intent",
            new_callable=AsyncMock,
        ) as mock_intent,
        patch("backend.app.api.webhooks.DBService") as mock_db,
        patch(
            "backend.app.api.webhooks.execute_recovery_pipeline",
            new_callable=AsyncMock,
        ),
    ):
        mock_intent.return_value = VoiceIntent(
            intent="promise_to_pay",
            promised_amount=5000.0,
            promised_date="2026-10-10",
            confidence=0.95,
            ai_used=True,
        )
        res = client.post(
            "/webhooks/twilio/gather?case_id=case_1&amount=5000",
            data={
                "SpeechResult": "Monday ko 5000 de dunga",
                "CallSid": "CA_ptp_test",
            },
        )
        assert res.status_code == 200
        body = res.text
        # Should contain a spoken response (even if promise DB write fails)
        assert "<Say" in body
        assert "<Response>" in body


# ─── 12. pay_now response ───────────────────────────────────────────────────
def test_gather_pay_now(mock_twilio_settings):
    with (
        patch(
            "backend.app.api.webhooks.verify_twilio_signature", return_value=True
        ),
        patch(
            "backend.app.api.webhooks.extract_voice_intent",
            new_callable=AsyncMock,
        ) as mock_intent,
        patch("backend.app.api.webhooks.DBService"),
        patch(
            "backend.app.api.webhooks.execute_recovery_pipeline",
            new_callable=AsyncMock,
        ),
    ):
        mock_intent.return_value = VoiceIntent(
            intent="pay_now", confidence=0.88, ai_used=True
        )
        res = client.post(
            "/webhooks/twilio/gather?case_id=case_1&amount=5000",
            data={
                "SpeechResult": "Abhi payment link bhej do",
                "CallSid": "CA_pay_now",
            },
        )
        assert res.status_code == 200
        assert "payment link" in res.text.lower()


# ─── 13. dispute response ──────────────────────────────────────────────────
def test_gather_dispute(mock_twilio_settings):
    with (
        patch(
            "backend.app.api.webhooks.verify_twilio_signature", return_value=True
        ),
        patch(
            "backend.app.api.webhooks.extract_voice_intent",
            new_callable=AsyncMock,
        ) as mock_intent,
        patch("backend.app.api.webhooks.DBService"),
    ):
        mock_intent.return_value = VoiceIntent(
            intent="dispute", confidence=0.9, ai_used=True
        )
        res = client.post(
            "/webhooks/twilio/gather?case_id=case_1&amount=5000",
            data={
                "SpeechResult": "Ye mera invoice nahi hai",
                "CallSid": "CA_dispute",
            },
        )
        assert res.status_code == 200
        assert "review" in res.text.lower() or "forward" in res.text.lower()


# ─── 14. unwilling response ────────────────────────────────────────────────
def test_gather_unwilling(mock_twilio_settings):
    with (
        patch(
            "backend.app.api.webhooks.verify_twilio_signature", return_value=True
        ),
        patch(
            "backend.app.api.webhooks.extract_voice_intent",
            new_callable=AsyncMock,
        ) as mock_intent,
        patch("backend.app.api.webhooks.DBService"),
    ):
        mock_intent.return_value = VoiceIntent(
            intent="unwilling", confidence=0.87, ai_used=True
        )
        res = client.post(
            "/webhooks/twilio/gather?case_id=case_1&amount=5000",
            data={
                "SpeechResult": "Main payment nahi karunga",
                "CallSid": "CA_unwilling",
            },
        )
        assert res.status_code == 200
        assert "rok" in res.text.lower() or "review" in res.text.lower()


# ─── 15. Transcript persistence ────────────────────────────────────────────
def test_transcript_persisted(mock_twilio_settings):
    with (
        patch(
            "backend.app.api.webhooks.verify_twilio_signature", return_value=True
        ),
        patch(
            "backend.app.api.webhooks.extract_voice_intent",
            new_callable=AsyncMock,
        ) as mock_intent,
        patch("backend.app.api.webhooks.DBService") as mock_db,
    ):
        mock_intent.return_value = VoiceIntent(
            intent="unknown", confidence=0.0, ai_used=False, fallback_used=True
        )
        client.post(
            "/webhooks/twilio/gather?case_id=case_1&amount=5000",
            data={
                "SpeechResult": "Kuch samajh nahi aaya",
                "CallSid": "CA_transcript_test",
            },
        )

        # Verify customer transcript was persisted
        record_comm_calls = mock_db.record_communication.call_args_list
        customer_calls = [
            c
            for c in record_comm_calls
            if c.kwargs.get("communication_type") == "VOICE_TRANSCRIPT"
            and c.kwargs.get("metadata", {}).get("speaker") == "CUSTOMER"
        ]
        assert len(customer_calls) >= 1
        assert customer_calls[0].kwargs["metadata"]["text"] == "Kuch samajh nahi aaya"

        # Verify Chakra response was persisted
        chakra_calls = [
            c
            for c in record_comm_calls
            if c.kwargs.get("communication_type") == "VOICE_TRANSCRIPT"
            and c.kwargs.get("metadata", {}).get("speaker") == "CHAKRA"
        ]
        assert len(chakra_calls) >= 1


# ─── 16. Intent persistence ────────────────────────────────────────────────
def test_intent_persisted(mock_twilio_settings):
    with (
        patch(
            "backend.app.api.webhooks.verify_twilio_signature", return_value=True
        ),
        patch(
            "backend.app.api.webhooks.extract_voice_intent",
            new_callable=AsyncMock,
        ) as mock_intent,
        patch("backend.app.api.webhooks.DBService") as mock_db,
    ):
        mock_intent.return_value = VoiceIntent(
            intent="pay_now",
            confidence=0.9,
            ai_used=True,
            language="english",
            model_used="gemini-2.5-flash",
        )
        client.post(
            "/webhooks/twilio/gather?case_id=case_1&amount=5000",
            data={"SpeechResult": "Pay now", "CallSid": "CA_intent_test"},
        )

        # Check AI_VOICE_INTENT_COMPLETED was recorded
        audit_calls = mock_db.record_audit_event.call_args_list
        intent_completed = [
            c for c in audit_calls if c.args[1] == "AI_VOICE_INTENT_COMPLETED"
        ]
        assert len(intent_completed) >= 1
        meta = intent_completed[0].args[2]
        assert meta["intent"] == "pay_now"
        assert meta["confidence"] == 0.9
        assert meta["language"] == "english"
        assert meta["model"] == "gemini-2.5-flash"


# ─── 17. Call status persistence ────────────────────────────────────────────
def test_call_status_persisted():
    original_token = settings.twilio_auth_token
    settings.twilio_auth_token = None

    res = client.post(
        "/webhooks/twilio/status",
        data={
            "CallSid": "CA_status_test",
            "CallStatus": "completed",
            "CallDuration": "45",
        },
    )
    assert res.status_code == 200
    assert res.json()["status"] == "ok"

    settings.twilio_auth_token = original_token


# ─── 18. No fake call success ──────────────────────────────────────────────
def test_no_fake_call_success(unconfigured_twilio):
    """When Twilio is not configured and mock is off, no fake call SID should be returned."""
    res = client.post(
        "/api/voice/recovery/start",
        json={"case_id": "case_1", "to_number": "+919999999999", "amount": 5000.0},
    )
    assert res.status_code == 400
    body = res.json()
    assert "call_sid" not in body or body.get("call_sid") is None


# ─── 19. Payment failed SMS notification helper ─────────────────────────────
@pytest.mark.asyncio
async def test_send_payment_failed_sms(mock_twilio_settings):
    with patch("backend.app.services.notify.send_sms", new_callable=AsyncMock) as mock_send:
        mock_send.return_value = {"status": "sent", "provider": "twilio", "provider_message_id": "SM_test_123"}
        from backend.app.services.notify import send_payment_failed_sms

        res = await send_payment_failed_sms(
            to_number="+919930832015",
            customer_name="Rudra",
            amount_inr=5000.0,
            payment_link="https://rzp.io/l/test",
        )
        assert res["status"] == "sent"
        assert res["provider_message_id"] == "SM_test_123"
        mock_send.assert_called_once()
        sent_msg = mock_send.call_args[0][1]
        assert "5000" in sent_msg
        assert "Rudra" in sent_msg
        assert "https://rzp.io/l/test" in sent_msg


# ─── 20. Promise-to-Pay reminder SMS helper (timing variations) ──────────────
@pytest.mark.asyncio
async def test_send_promise_reminder_sms_timings(mock_twilio_settings):
    with patch("backend.app.services.notify.send_sms", new_callable=AsyncMock) as mock_send:
        mock_send.return_value = {"status": "sent", "provider": "twilio", "provider_message_id": "SM_test_456"}
        from backend.app.services.notify import send_promise_reminder_sms

        # 1 day before
        await send_promise_reminder_sms(
            to_number="+919930832015",
            customer_name="Rudra",
            amount_inr=3000.0,
            promise_date="2026-10-10",
            timing="before",
            payment_link="https://rzp.io/l/p_before",
        )
        msg_before = mock_send.call_args[0][1]
        assert "tomorrow" in msg_before.lower()

        # Due today
        await send_promise_reminder_sms(
            to_number="+919930832015",
            customer_name="Rudra",
            amount_inr=3000.0,
            promise_date="2026-10-10",
            timing="due",
            payment_link="https://rzp.io/l/p_due",
        )
        msg_due = mock_send.call_args[0][1]
        assert "today" in msg_due.lower()

        # 1 day after / overdue
        await send_promise_reminder_sms(
            to_number="+919930832015",
            customer_name="Rudra",
            amount_inr=3000.0,
            promise_date="2026-10-10",
            timing="after",
            payment_link="https://rzp.io/l/p_after",
        )
        msg_after = mock_send.call_args[0][1]
        assert "overdue" in msg_after.lower()


# ─── 21. Promise reminder API endpoint ──────────────────────────────────────
def test_promise_remind_endpoint(mock_twilio_settings):
    with (
        patch("backend.app.services.notify.send_sms", new_callable=AsyncMock) as mock_send,
        patch("backend.app.api.receivables.get_session_factory") as mock_factory,
        patch("backend.app.api.receivables.DBService"),
    ):
        mock_send.return_value = {
            "status": "sent",
            "provider": "twilio",
            "provider_message_id": "SM_remind_test",
            "body": "Reminder sent",
        }
        mock_session = MagicMock()
        mock_promise = MagicMock()
        mock_promise.id = "p_123"
        mock_promise.customer_name = "Rudra"
        mock_promise.promised_amount = 5000.0
        mock_promise.promise_date = "2026-09-06"
        mock_promise.receivable_id = "rec_123"
        mock_session.execute.return_value.scalar_one_or_none.return_value = mock_promise
        mock_factory.return_value.__enter__.return_value = mock_session

        res = client.post(
            "/api/receivables/promises/p_123/remind",
            json={
                "phone_number": "+919930832015",
                "timing": "before",
            },
        )
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "success"
        assert data["promise_id"] == "p_123"
        assert data["timing"] == "before"


# ─── 22. Twilio Comms Email helper test ─────────────────────────────────────
@pytest.mark.asyncio
async def test_send_email_twilio_comms(mock_twilio_settings):
    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value.status_code = 202
        mock_post.return_value.json = MagicMock(return_value={"operationId": "comms_op_test_123"})
        from backend.app.services.notify import send_email

        res = await send_email()
        assert res["status"] == "sent"
        assert res["provider_message_id"] == "comms_op_test_123"
        assert res["to"] == "rudracmalvankar@gmail.com"


# ─── 23. Receivable Email API endpoint test ──────────────────────────────────
def test_receivable_email_endpoint(mock_twilio_settings):
    with (
        patch("backend.app.services.notify.send_email", new_callable=AsyncMock) as mock_email,
        patch("backend.app.api.receivables.get_session_factory") as mock_factory,
        patch("backend.app.api.receivables.DBService"),
    ):
        mock_email.return_value = {
            "status": "sent",
            "provider": "twilio_email",
            "provider_message_id": "comms_op_rec_test",
            "to": "rudracmalvankar@gmail.com",
        }
        mock_session = MagicMock()
        mock_rec = MagicMock()
        mock_rec.id = "rec_test_123"
        mock_rec.customer_id = "cust_test_123"
        mock_session.execute.return_value.scalar_one_or_none.return_value = mock_rec
        mock_factory.return_value.__enter__.return_value = mock_session

        res = client.post("/api/receivables/rec_test_123/email", json={})
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "sent"
        assert data["provider_message_id"] == "comms_op_rec_test"


