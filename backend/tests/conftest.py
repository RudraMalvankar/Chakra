import pytest
import os
from backend.app.db.session import init_db
from backend.app.lib.audit import clear_audit_log

@pytest.fixture(scope='session', autouse=True)
def setup_test_environment():
    os.environ['DATABASE_URL'] = 'sqlite:///./test.db'
    os.environ['GEMINI_API_KEY'] = 'mock_key_for_ci'
    init_db()
    clear_audit_log()

