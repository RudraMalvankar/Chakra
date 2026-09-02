# backend/app/config.py
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional

class Settings(BaseSettings):
    # Application Mode
    dry_run: bool = False
    
    # API Keys
    razorpay_key_id: Optional[str] = None
    razorpay_key_secret: Optional[str] = None
    gemini_api_key: Optional[str] = None
    
    # Toggle for using the Mock Server instead of real Razorpay
    use_mock_razorpay: bool = True
    mock_razorpay_url: str = "http://localhost:8001"
    
    # Paths
    rules_path: str = "backend/app/data/rules.yaml"
    templates_path: str = "backend/app/data/templates.yaml"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

settings = Settings()
