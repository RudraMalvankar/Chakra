from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.app.api.webhooks import router as webhook_router
from backend.app.services.metrics_aggregator import generate_metrics_report
from backend.app.lib.audit import AUDIT_FILE
import json
import os

app = FastAPI(title="Chakra Recovery Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(webhook_router, prefix="/webhooks")

@app.get("/health")
def health_check():
    return {"status": "healthy"}

@app.get("/api/metrics")
def get_metrics():
    return generate_metrics_report()

@app.get("/api/audit")
def get_audit_trail(limit: int = 100):
    if not os.path.exists(AUDIT_FILE):
        return {"events": []}
    events = []
    with open(AUDIT_FILE, "r") as f:
        for line in f:
            if line.strip():
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    # Return newest first, limited
    return {"events": events[::-1][:limit]}
