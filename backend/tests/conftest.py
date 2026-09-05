import pytest
from backend.app.config import settings
from backend.app.db import session as db_session
from backend.app.db.session import init_db
from backend.app.lib.audit import clear_audit_log

@pytest.fixture(scope='session', autouse=True)
def setup_test_environment():
    """Run every test against an isolated SQLite database.

    ``Settings`` is instantiated while application modules are imported, so
    changing ``os.environ`` here is too late.  Reset the cached engine after
    updating that authoritative settings instance instead.
    """
    settings.database_url = 'sqlite:///./test.db'
    # Tests exercise explicit synthetic/provider stubs only.  Never inherit
    # developer credentials from .env and accidentally call live test-mode APIs.
    settings.razorpay_key_id = None
    settings.razorpay_key_secret = None
    settings.gemini_api_key = None
    settings.twilio_account_sid = None
    settings.twilio_auth_token = None
    settings.twilio_from_number = None
    settings.use_mock_razorpay = True
    settings.use_mock_voice = True

    if db_session._engine is not None:
        db_session._engine.dispose()
    db_session._engine = None
    db_session._SessionFactory = None

    init_db()
    clear_audit_log()

    # Prevent safety_gate DB state from leaking between tests
    import backend.app.services.safety_gate as sg
    sg._skip_db_state = True
    sg.reset_safety_state()

    yield

    if db_session._engine is not None:
        db_session._engine.dispose()
    db_session._engine = None
    db_session._SessionFactory = None

