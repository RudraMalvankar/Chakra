import re
with open('backend/app/main.py', 'r') as f:
    text = f.read()

import_target = "from backend.app.api.cases import router as cases_router\nfrom backend.app.api.webhooks import router as webhooks_router"
import_replacement = "from backend.app.api.cases import router as cases_router\nfrom backend.app.api.webhooks import router as webhooks_router\nfrom backend.app.api.voice import router as voice_router"

text = text.replace(import_target, import_replacement)

router_target = "app.include_router(cases_router)\napp.include_router(webhooks_router)"
router_replacement = "app.include_router(cases_router)\napp.include_router(webhooks_router)\napp.include_router(voice_router)"

text = text.replace(router_target, router_replacement)

with open('backend/app/main.py', 'w') as f:
    f.write(text)
