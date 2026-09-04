"""
Database Session Management for Neon Postgres.
Uses SQLAlchemy 2.x with connection pooling and pre-ping.
"""
from typing import Generator
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base, Session
from backend.app.config import settings
import logging

logger = logging.getLogger("chakra.db")

Base = declarative_base()

_engine = None
_SessionFactory = None

def get_engine():
    global _engine, _SessionFactory
    if _engine is None:
        db_url = settings.database_url
        if not db_url:
            raise RuntimeError(
                "DATABASE_URL is not set. Configure DATABASE_URL in .env to connect to Neon Postgres."
            )
        # Ensure psycopg driver prefix
        if db_url.startswith("postgres://"):
            db_url = db_url.replace("postgres://", "postgresql+psycopg://", 1)
        elif db_url.startswith("postgresql://") and "+psycopg" not in db_url:
            db_url = db_url.replace("postgresql://", "postgresql+psycopg://", 1)

        _engine = create_engine(
            db_url,
            pool_pre_ping=True,
            pool_size=10,
            max_overflow=20,
            pool_recycle=300,
        )
        _SessionFactory = sessionmaker(autocommit=False, autoflush=False, bind=_engine)
    return _engine

def get_session_factory():
    global _SessionFactory
    if _SessionFactory is None:
        get_engine()
    return _SessionFactory

def get_db() -> Generator[Session, None, None]:
    """FastAPI Dependency for database sessions."""
    try:
        factory = get_session_factory()
        db = factory()
        try:
            yield db
        finally:
            db.close()
    except Exception as e:
        logger.error(f"Database session error: {e}")
        raise

def init_db():
    """Initializes tables if not already created. TEST/BOOTSTRAP ONLY — production uses Alembic."""
    engine = get_engine()
    from backend.app.db import models  # noqa: F401
    Base.metadata.create_all(bind=engine)


def ensure_schema():
    """Production schema check: verifies tables exist without mutating schema.
    Raises RuntimeError if schema is missing, directing to run alembic upgrade head."""
    try:
        engine = get_engine()
        from sqlalchemy import inspect
        inspector = inspect(engine)
        tables = inspector.get_table_names()
        required = ['customers', 'payments', 'recovery_cases', 'recovery_decisions',
                     'recovery_events', 'provider_events', 'audit_events',
                     'batch_runs', 'batch_cases', 'receivables', 'promises_to_pay',
                     'voice_interactions']
        missing = [t for t in required if t not in tables]
        if missing:
            raise RuntimeError(
                f"Missing tables: {missing}. Run 'alembic upgrade head' to create the schema."
            )
    except RuntimeError:
        raise
    except Exception as e:
        logger.warning(f"Schema check skipped: {e}")
