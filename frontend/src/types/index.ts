export interface Payment {
  id: string;
  amount: number;
  status: string;
  method: string;
  error_code?: string;
  customer_id: string;
  created_at: string;
}

export interface Case {
  id: string;
  type: string;
  status: string;
  amount: number;
  last_updated: string;
  risk?: any;
  agent?: any;
  safety?: any;
  outcome?: any;
  events: any[];
}

export interface InterventionMetrics {
  attempted: number;
  succeeded: number;
  recovered_inr: number;
}

export interface CaseTypeMetrics {
  processed: number;
  recovered: number;
  revenue_at_risk: number;
  revenue_recovered: number;
}

export interface Metrics {
  payments_processed: number;
  payments_recovery_eligible: number;
  payments_blocked: number;
  payments_escalated: number;
  interventions_attempted: number;
  interventions_succeeded: number;
  payments_recovered: number;
  payments_failed_recovery: number;
  revenue_at_risk_inr: number;
  revenue_attempted_inr: number;
  revenue_recovered_inr: number;
  revenue_pending_inr: number;
  revenue_blocked_inr: number;
  revenue_escalated_inr: number;
  revenue_recovery_rate_pct: number;
  payment_recovery_rate_pct: number;
  intervention_success_rate_pct: number;
  safety_block_rate_pct: number;
  escalation_rate_pct: number;
  ai_triage_count?: number;
  ai_fallback_count?: number;
  ai_live_rate_pct?: number;
  by_case_type: Record<string, CaseTypeMetrics>;
  by_intervention: Record<string, InterventionMetrics>;
}
