"""
Compatibility layer re-exporting MandateRouter for backward compatibility with existing tests and scripts.
"""
from backend.app.services.mandate_router import MandateRouter, route, route_payment

__all__ = ["MandateRouter", "route", "route_payment"]
