
import re
with open("backend/tests/test_voice_recovery.py", "r") as f:
    text = f.read()

text = text.replace("mock_post.return_value.json.return_value = {\"sid\": \"CA_test_sid_123\"}", "from unittest.mock import MagicMock\n        mock_post.return_value.json = MagicMock(return_value={\"sid\": \"CA_test_sid_123\"})")

with open("backend/tests/test_voice_recovery.py", "w") as f:
    f.write(text)

