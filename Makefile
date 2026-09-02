.PHONY: install mock backend trigger demo test

install:
	pip install -r requirements.txt

mock:
	uvicorn mock-razorpay.main:app --port 8001 --reload

backend:
	uvicorn backend.app.main:app --port 8000 --reload

trigger:
	python backend/scripts/trigger_webhooks.py

demo:
	@echo "Starting Mock Razorpay and Chakra Backend in the background..."
	@start /B uvicorn mock-razorpay.main:app --port 8001 > mock.log 2>&1
	@start /B uvicorn backend.app.main:app --port 8000 > backend.log 2>&1
	@echo "Waiting for servers to start..."
	@timeout /T 5 /NOBREAK > nul
	@echo "Triggering Webhooks..."
	@python backend/scripts/trigger_webhooks.py
	@echo "Servers are still running in the background. Close terminal to kill them."

test:
	pytest backend/tests/
