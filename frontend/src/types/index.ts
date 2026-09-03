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

export interface Metrics {
  revenue_at_risk_inr: number;
  revenue_recovered_inr: number;
  revenue_recovery_rate_pct: number;
  revenue_attempted_inr: number;
  revenue_blocked_inr: number;
  revenue_escalated_inr: number;
  payments_processed: number;
  payments_recovered: number;
  payments_blocked: number;
  payments_escalated: number;
  by_case_type: Record<string, any>;
  by_intervention: Record<string, any>;
}
