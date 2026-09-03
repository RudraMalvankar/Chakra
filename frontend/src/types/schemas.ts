import { z } from 'zod';

export const PaymentSchema = z.object({
  id: z.string(),
  amount: z.number(),
  status: z.string(),
  method: z.string().optional(),
  error_code: z.string().optional(),
  customer_id: z.string().optional(),
  created_at: z.string().optional(),
});

export const EventSchema = z.object({
  timestamp: z.string(),
  payment_id: z.string(),
  event_type: z.string(),
  details: z.any()
});

export const AuditLogSchema = z.object({
  events: z.array(EventSchema)
});

export const MetricsSchema = z.any(); // We can trust the backend metrics schema for now or strictly define it
