import type { Metrics } from '../types';
import { AuditLogSchema } from '../types/schemas';

// Production deploys Chakra behind one origin.  Local development supplies this
// value through VITE_API_BASE_URL; no backend address is baked into the bundle.
export const API_BASE = (import.meta.env.VITE_API_BASE_URL || window.location.origin).replace(/\/$/, '');

export const fetchMetrics = async (): Promise<Metrics> => {
  const res = await fetch(`${API_BASE}/api/metrics`);
  if (!res.ok) throw new Error("Failed to fetch metrics");
  const data = await res.json();
  return data.metrics || data;
};

export const fetchAuditLog = async (limit = 2000) => {
  const res = await fetch(`${API_BASE}/api/audit?limit=${limit}`);
  if (!res.ok) throw new Error("Failed to fetch audit log");
  const data = await res.json();
  try {
      const valid = AuditLogSchema.parse(data);
      return valid.events;
  } catch {
      console.warn("Zod validation failed on audit log, falling back to raw data");
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
    } catch {
        return [];
    }
};

export const fetchConfig = async () => {
    try {
        const res = await fetch(`${API_BASE}/api/config`);
        if (!res.ok) return { mode: 'unavailable', provider: 'unavailable' };
        return res.json();
    } catch {
        return { mode: 'unavailable', provider: 'unavailable' };
    }
};

export const fetchCases = async (limit = 200) => {
  const res = await fetch(`${API_BASE}/api/cases?limit=${limit}`);
  if (!res.ok) throw new Error(`Unable to load cases (${res.status})`);
  return res.json();
};

export const fetchCaseDetail = async (caseId: string) => {
  const res = await fetch(`${API_BASE}/api/cases/${encodeURIComponent(caseId)}`);
  if (!res.ok) throw new Error(`Unable to load case (${res.status})`);
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
