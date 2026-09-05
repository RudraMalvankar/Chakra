import type { Metrics } from '../types';
import { AuditLogSchema } from '../types/schemas';

// Production deploys may set VITE_API_BASE_URL. Local Vite uses same-origin
// paths so /api/* is proxied to FastAPI (see vite.config.ts).
export const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

export class ApiError extends Error {
  readonly kind: 'network' | 'http' | 'parse';
  readonly status?: number;

  constructor(message: string, kind: 'network' | 'http' | 'parse', status?: number) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
  }
}

function apiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE}${normalized}`;
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), init);
  } catch {
    throw new ApiError(
      'Unable to reach the Chakra backend. Is it running on port 8001?',
      'network',
    );
  }
  return res;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await request(path, init);
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = typeof body?.detail === 'string' ? body.detail : JSON.stringify(body?.detail ?? body);
    } catch {
      detail = await res.text().catch(() => '');
    }
    throw new ApiError(
      detail || `Request failed (${res.status})`,
      'http',
      res.status,
    );
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError('Backend returned invalid JSON', 'parse', res.status);
  }
}

export const fetchMetrics = async (): Promise<Metrics> => {
  const data = await requestJson<any>('/api/metrics');
  return data.metrics || data;
};

export const fetchAuditLog = async (limit = 2000) => {
  const data = await requestJson<any>(`/api/audit?limit=${limit}`);
  try {
    const valid = AuditLogSchema.parse(data);
    return valid.events;
  } catch {
    console.warn('Zod validation failed on audit log, falling back to raw data');
    return data.events || [];
  }
};

export const simulatePayment = async (payload: unknown) => {
  return requestJson<any>('/api/demo/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
};

/** Provider payments — throws on network/HTTP failure; never pretends empty. */
export const fetchProviderPayments = async (): Promise<any[]> => {
  const data = await requestJson<any>('/api/payments');
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  throw new ApiError('Payments response was invalid', 'parse');
};

/** @deprecated Use fetchProviderPayments — kept for import compatibility during migration */
export const fetchMockPayments = fetchProviderPayments;

export const fetchConfig = async () => {
  return requestJson<{ provider: string; mode: string; razorpay_key_id?: string }>('/api/config');
};

export const fetchHealth = async () => {
  return requestJson<{
    status: string;
    database: string;
    razorpay: string;
    twilio: string;
    gemini: string;
  }>('/health');
};

export const fetchCases = async (limit = 200) => {
  return requestJson<any[]>(`/api/cases?limit=${limit}`);
};

export const getCases = async () => {
  return requestJson<any>('/api/cases');
};

export const fetchCaseDetail = async (caseId: string) => {
  return requestJson<any>(`/api/cases/${encodeURIComponent(caseId)}`);
};

export const createOrder = async (payload: { amount_inr: number; customer_id: string }) => {
  return requestJson<any>('/api/payments/create_order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
};

export const verifyPayment = async (payload: {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
  customer_id?: string;
}) => {
  return requestJson<any>('/api/payments/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
};

export const abandonCheckout = async (payload: {
  order_id: string;
  amount_inr?: number;
  customer_id: string;
}) => {
  return requestJson<any>('/api/payments/abandon', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
};

export const fetchPolicy = async () => {
  return requestJson<any>('/api/policy');
};

// ─── Voice Recovery ───────────────────────────────────────────────────────────

export const startVoiceRecovery = async (payload: {
  case_id: string;
  to_number: string;
  amount: number;
  customer_name?: string;
}) => {
  return requestJson<any>('/api/voice/recovery/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
};

export const getVoiceRecoveryStatus = async (call_sid: string) => {
  return requestJson<any>(`/api/voice/recovery/${call_sid}`);
};

export const startSimulatedVoiceCall = async (payload: {
  case_id: string;
  amount: number;
  customer_name?: string;
  voice_preference?: string;
}) => {
  return requestJson<any>('/api/voice/simulate/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
};

export const sendSimulatedVoiceTurn = async (payload: {
  case_id: string;
  call_sid: string;
  user_speech: string;
  amount: number;
  customer_name?: string;
  voice_preference?: string;
}) => {
  return requestJson<any>('/api/voice/simulate/turn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
};

// ─── Twilio SMS & Reminders ───────────────────────────────────────────────────

export const sendReceivableSms = async (
  receivableId: string,
  payload: { phone_number: string; message?: string }
) => {
  return requestJson<any>(`/api/receivables/${encodeURIComponent(receivableId)}/sms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
};

export const sendPromiseReminder = async (
  promiseId: string,
  payload: {
    phone_number: string;
    timing?: 'before' | 'due' | 'after' | 'auto';
    payment_link?: string;
    custom_message?: string;
  }
) => {
  return requestJson<any>(`/api/receivables/promises/${encodeURIComponent(promiseId)}/remind`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
};

export const dispatchPromiseReminders = async (payload?: { default_phone?: string }) => {
  return requestJson<any>('/api/receivables/promises/dispatch-reminders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
};

// ─── Twilio Comms Email ───────────────────────────────────────────────────────

export const sendReceivableEmail = async (
  receivableId: string,
  payload?: { to_email?: string; subject?: string; html_content?: string }
) => {
  return requestJson<any>(`/api/receivables/${encodeURIComponent(receivableId)}/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
};

export const sendPromiseEmail = async (
  promiseId: string,
  payload?: { to_email?: string; subject?: string; html_content?: string }
) => {
  return requestJson<any>(`/api/receivables/promises/${encodeURIComponent(promiseId)}/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
};

export { request, requestJson, apiUrl };
