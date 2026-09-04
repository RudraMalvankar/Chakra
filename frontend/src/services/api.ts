import type { Metrics } from '../types';
import { AuditLogSchema } from '../types/schemas';

export const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8001";
const GATEWAY_BASE = 'http://localhost:8002'; // Mock Razorpay

export const fetchMetrics = async (): Promise<Metrics> => {
  const res = await fetch(`${API_BASE}/api/metrics`);
  if (!res.ok) throw new Error("Failed to fetch metrics");
  return res.json();
};

export const fetchAuditLog = async (limit = 2000) => {
  const res = await fetch(`${API_BASE}/api/audit?limit=${limit}`);
  if (!res.ok) throw new Error("Failed to fetch audit log");
  const data = await res.json();
  try {
      const valid = AuditLogSchema.parse(data);
      return valid.events;
  } catch (_err) {
      console.warn("Zod validation failed on audit log, falling back to raw data", err);
      return data.events || [];
  }
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

export const fetchMockPayments = async () => {
    try {
        const res = await fetch(`${API_BASE}/api/payments`);
        if (!res.ok) return [];
        const data = await res.json();
        return data.items || [];
    } catch (_err) {
        return [];
    }
};

export const retryMockPayment = async (id: string) => {
    const res = await fetch(`${GATEWAY_BASE}/v1/payments/${id}/retry`, { method: 'POST' });
    if (!res.ok) throw new Error("Failed");
    return res.json();
};

export const fetchConfig = async () => {
    const res = await fetch(`${API_BASE}/api/config`);
    if (!res.ok) return { mode: 'synthetic' };
    return res.json();
};

export const createOrder = async (payload: any) => {
    const res = await fetch(`${API_BASE}/api/payments/create_order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error("Failed to create order");
    return res.json();
};
