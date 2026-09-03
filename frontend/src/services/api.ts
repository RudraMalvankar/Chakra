import type { Case, Metrics, Payment } from '../types';

const API_BASE = 'http://localhost:8001';

export const fetchMetrics = async (): Promise<Metrics> => {
  const res = await fetch(`${API_BASE}/api/metrics`);
  if (!res.ok) throw new Error("Failed to fetch metrics");
  return res.json();
};

export const fetchAuditLog = async (limit = 2000) => {
  const res = await fetch(`${API_BASE}/api/audit?limit=${limit}`);
  if (!res.ok) throw new Error("Failed to fetch audit log");
  const data = await res.json();
  return data.events || [];
};

export const simulatePayment = async (payload: any) => {
  const res = await fetch(`${API_BASE}/api/demo/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error("Failed to simulate payment");
  return res.json();
};
