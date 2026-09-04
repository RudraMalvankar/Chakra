# backend/app/config.py
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional, List

class Settings(BaseSettings):
    # Application Mode
    dry_run: bool = False

    # Neon Postgres Database
    database_url: Optional[str] = None

    # Razorpay Test Mode Keys
    razorpay_key_id: Optional[str] = None
    razorpay_key_secret: Optional[str] = None
    razorpay_webhook_secret: Optional[str] = None
    webhook_secret: str = "test_secret_for_hmac"

    # Gemini API Configuration
    gemini_api_key: Optional[str] = None
    gemini_model: str = "gemini-3-flash-preview"
    gemini_fallback_model: str = "gemini-2.5-flash"

    # Twilio Voice Configuration
    twilio_account_sid: Optional[str] = None
    twilio_auth_token: Optional[str] = None
    twilio_from_number: Optional[str] = None
    twilio_webhook_base_url: Optional[str] = None

    # Toggle for using the Mock Server instead of real Razorpay
    use_mock_razorpay: bool = True
    mock_razorpay_url: str = "http://localhost:8002"

    # CORS
    cors_origins: str = "*"

    # Paths
    regulatory_policy_path: str = "backend/app/data/regulatory_policy.yaml"
    recovery_policy_path: str = "backend/app/data/recovery_policy.yaml"
    templates_path: str = "backend/app/data/templates.yaml"

    @property
    def is_razorpay_configured(self) -> bool:
        return bool(self.razorpay_key_id and self.razorpay_key_secret)

    @property
    def is_twilio_configured(self) -> bool:
        return bool(self.twilio_account_sid and self.twilio_auth_token and self.twilio_from_number)

    @property
    def is_gemini_configured(self) -> bool:
        return bool(self.gemini_api_key)

    @property
    def is_database_configured(self) -> bool:
        return bool(self.database_url)

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

settings = Settings()

