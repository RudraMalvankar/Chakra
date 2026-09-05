import re
with open('backend/app/api/webhooks.py', 'r') as f:
    text = f.read()

status_endpoint = '''@router.post("/twilio/status")
async def twilio_status(request: Request, case_id: str = "", x_twilio_signature: Optional[str] = Header(None)):
    form = await request.form()
    form_params = dict(form)
    
    if settings.twilio_auth_token:
        if not verify_twilio_signature(request, form_params, x_twilio_signature):
            raise HTTPException(status_code=403, detail="Invalid Twilio signature")

    call_sid = form.get("CallSid")
    status = form.get("CallStatus", "unknown")
    duration = form.get("CallDuration")
    
    DBService.record_audit_event(
        case_id or call_sid,
        "voice_call_status",
        {
            "call_sid": call_sid,
            "status": status,
            "duration": duration
        }
    )
    
    DBService.record_communication(
        case_id=case_id or None,
        customer_id=None,
        channel="VOICE",
        communication_type="CALL_STATUS_UPDATE",
        provider="twilio" if settings.is_twilio_configured else "mock",
        provider_message_id=call_sid,
        status=status,
        metadata={"duration": duration, "call_sid": call_sid}
    )
    
    return {"status": "ok"}
'''

if 'def twilio_status' not in text:
    text += '\n\n' + status_endpoint
    with open('backend/app/api/webhooks.py', 'w') as f:
        f.write(text)
