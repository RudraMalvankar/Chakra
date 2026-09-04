import pytest
from backend.app.services.razorpay_client import SyntheticPaymentProvider, RazorpayTestProvider

@pytest.mark.asyncio
async def test_synthetic_provider_online_retry():
    provider = SyntheticPaymentProvider()
    
    from unittest.mock import patch, AsyncMock, MagicMock
    with patch("httpx.AsyncClient.post") as mock_post:
        mock_resp = AsyncMock()
        mock_resp.status_code = 200
        mock_resp.json = MagicMock(return_value={"status": "captured"})
        mock_post.return_value = mock_resp
        
        res = await provider.retry_payment("p_123", 0)
        assert res["status"] == "captured"

@pytest.mark.asyncio
async def test_synthetic_provider_500():
    provider = SyntheticPaymentProvider()
    
    from unittest.mock import patch, AsyncMock
    with patch("httpx.AsyncClient.post") as mock_post:
        mock_resp = AsyncMock()
        mock_resp.status_code = 500
        mock_post.return_value = mock_resp
        
        res = await provider.retry_payment("p_123", 0)
        assert res["status"] == "failed"
        assert "HTTP 500" in res["error"]

@pytest.mark.asyncio
async def test_synthetic_provider_timeout():
    import httpx
    provider = SyntheticPaymentProvider()
    
    from unittest.mock import patch
    with patch("httpx.AsyncClient.post") as mock_post:
        mock_post.side_effect = httpx.RequestError("timeout")
        
        res = await provider.retry_payment("p_123", 0)
        assert res["status"] == "failed"
        assert res["error"] == "network_error"

@pytest.mark.asyncio
async def test_razorpay_test_provider_retry():
    provider = RazorpayTestProvider("test_id", "test_sec")
    res = await provider.retry_payment("p_123", 0)
    assert res["status"] == "failed"
    assert res["error"] == "unsupported_operation"
