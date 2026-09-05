import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, ShieldAlert, Shield, Lock, AlertTriangle } from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { fetchPolicy } from '../services/api';

type PolicyRule = { name: string; value: string; type: string };

function buildRulesFromPolicy(policy: any): PolicyRule[] {
    if (!policy) return [];
    const retry = policy.retry_limit ?? policy.recovery?.max_interventions_per_customer_per_month;
    const afa = policy.afa_threshold_inr ?? policy.regulatory?.afa_free_threshold_standard_inr;
    const budgetDesc =
        policy.budget?.description ??
        (retry != null ? `${retry} interventions per customer per month` : null);
    const caps = policy.network_retry_caps || policy.regulatory?.network_retry_caps || {};
    const capParts = Object.entries(caps)
        .map(([k, v]) => `${String(k).toUpperCase()}: ${v}`)
        .join(', ');
    const mandate = policy.mandate_policy;
    const mandateValue =
        typeof mandate === 'object' && mandate
            ? `Revoked → ${mandate.revoked || 'Hard stop'}; first txn AFA: ${
                  mandate.first_transaction_requires_afa ? 'required' : 'optional'
              }`
            : 'Mandate revoked → hard stop';

    const rules: PolicyRule[] = [];
    if (retry != null) {
        rules.push({ name: 'Maximum Retry / Intervention Budget', value: `${retry} per customer per month`, type: 'CAP' });
    }
    if (policy.fraud_policy) {
        rules.push({ name: 'Fraud Threshold', value: String(policy.fraud_policy), type: 'RISK' });
    }
    rules.push({ name: 'Mandate Revoked Policy', value: mandateValue, type: 'COMPLIANCE' });
    if (Array.isArray(policy.escalation_rules) && policy.escalation_rules.length) {
        rules.push({ name: 'Escalation Rules', value: policy.escalation_rules.join('; '), type: 'ESCALATION' });
    }
    if (budgetDesc) {
        rules.push({ name: 'Monthly Recovery Budget', value: budgetDesc, type: 'BUDGET' });
    }
    if (afa != null) {
        rules.push({ name: 'AFA Payment Links', value: `Required above ₹${Number(afa).toLocaleString('en-IN')}`, type: 'CAP' });
    }
    if (capParts) {
        rules.push({ name: 'Network Retry Caps', value: capParts, type: 'CAP' });
    }
    if (Array.isArray(policy.stopping_rules) && policy.stopping_rules.length) {
        rules.push({ name: 'Stopping Rules', value: policy.stopping_rules.join('; '), type: 'COMPLIANCE' });
    }
    return rules;
}

export const Safety = ({ cases }: any) => {
    const navigate = useNavigate();
    const [policy, setPolicy] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        fetchPolicy()
            .then((data) => {
                if (!cancelled) setPolicy(data);
            })
            .catch((e) => {
                if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to load policy');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const rules = buildRulesFromPolicy(policy);
    const caseList = Array.isArray(cases) ? cases : [];
    const recentDecisions = caseList
        .filter((c: any) => c.safety != null && (c.safety.eligibility || c.safety.decision || c.safety.reason_code))
        .sort((a: any, b: any) => new Date(b.last_updated || 0).getTime() - new Date(a.last_updated || 0).getTime())
        .slice(0, 15);

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            <div className="bg-white border border-border shadow-sm p-6 flex justify-between items-center">
                <div>
                    <h2 className="text-lg font-bold text-text-main uppercase tracking-wider flex items-center">
                        <Shield className="mr-3 text-rzp-blue" size={20} />
                        Safety & Policies
                    </h2>
                    <p className="text-sm text-text-muted mt-1">Deterministic financial controls that cannot be overridden by AI.</p>
                </div>
                <div className="bg-gray-50 border border-gray-200 p-3 rounded flex items-center">
                    <Lock className="text-rzp-blue mr-2" size={16} />
                    <span className="text-xs font-bold text-text-main uppercase tracking-widest">AI OVERRIDE: DISABLED</span>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="bg-white border border-border shadow-sm flex flex-col h-[600px]">
                    <div className="px-6 py-4 border-b border-border bg-gray-50">
                        <h3 className="text-xs font-bold text-text-main uppercase tracking-wider">Active Policies</h3>
                    </div>
                    <div className="p-6 space-y-4 overflow-auto flex-1">
                        {loading && (
                            <div className="text-sm font-mono text-text-muted">Loading policy from backend…</div>
                        )}
                        {!loading && error && (
                            <div className="text-sm font-mono text-rzp-red">Unable to load policy. Reason: {error}</div>
                        )}
                        {!loading && !error && rules.length === 0 && (
                            <div className="text-sm font-mono text-text-muted">No policy rules available.</div>
                        )}
                        {!loading && !error && rules.map((r, i) => (
                            <div key={i} className="pb-4 border-b border-border last:border-0 last:pb-0">
                                <div className="flex justify-between items-start mb-1">
                                    <span className="font-bold text-text-main text-sm">{r.name}</span>
                                    <Badge status={r.type === 'COMPLIANCE' ? 'CRITICAL' : r.type === 'RISK' ? 'HIGH' : 'LOW'} className="text-[10px]">{r.type}</Badge>
                                </div>
                                <div className="font-mono text-sm text-text-muted">{r.value}</div>
                            </div>
                        ))}

                        <div className="mt-8 p-4 bg-blue-50 border border-blue-100 rounded flex items-start">
                            <AlertTriangle className="text-rzp-blue mr-3 shrink-0 mt-0.5" size={16} />
                            <div className="text-xs text-rzp-blue">
                                <span className="font-bold uppercase tracking-widest block mb-1">Architecture Note</span>
                                The Safety Gate executes deterministically after the AI Triage and Recovery Agent. It evaluates the agent's proposed action against policy loaded from YAML (never overridden by the model).
                            </div>
                        </div>
                    </div>
                </div>

                <div className="lg:col-span-2 bg-white border border-border shadow-sm flex flex-col h-[600px]">
                    <div className="px-6 py-4 border-b border-border bg-gray-50">
                        <h3 className="text-xs font-bold text-text-main uppercase tracking-wider">Recent Safety Decisions</h3>
                    </div>
                    <div className="overflow-auto flex-1">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="bg-white border-b border-border text-text-muted sticky top-0">
                                <tr>
                                    <th className="px-6 py-3 font-semibold text-xs tracking-wider uppercase">Case</th>
                                    <th className="px-6 py-3 font-semibold text-xs tracking-wider uppercase">Proposed Action</th>
                                    <th className="px-6 py-3 font-semibold text-xs tracking-wider uppercase">Safety Decision</th>
                                    <th className="px-6 py-3 font-semibold text-xs tracking-wider uppercase">Reason</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {recentDecisions.length === 0 && (
                                    <tr>
                                        <td colSpan={4} className="px-6 py-8 text-center text-text-muted font-mono text-sm">
                                            No recent safety decisions.
                                        </td>
                                    </tr>
                                )}
                                {recentDecisions.map((c: any) => {
                                    const decision = c.safety?.eligibility || c.safety?.decision;
                                    const isAllowed = decision === 'ALLOWED';
                                    const isBlocked = decision === 'BLOCKED' || decision === 'BLOCK';
                                    const isEscalated = decision === 'ESCALATED' || decision === 'ESCALATE';
                                    return (
                                        <tr key={c.id} onClick={() => navigate(`/cases/${c.id}`)} className="hover:bg-gray-50 cursor-pointer">
                                            <td className="px-6 py-3 font-mono font-medium text-rzp-blue">{String(c.id).substring(0, 8)}</td>
                                            <td className="px-6 py-3 font-mono text-xs">{c.agent?.selected_action || c.current_action || '-'}</td>
                                            <td className="px-6 py-3">
                                                <div className="flex items-center">
                                                    {isAllowed && <ShieldCheck className="text-green-500 mr-2" size={14} />}
                                                    {isBlocked && <ShieldAlert className="text-red-500 mr-2" size={14} />}
                                                    {isEscalated && <ShieldAlert className="text-orange-500 mr-2" size={14} />}
                                                    <span className={`text-xs font-bold uppercase tracking-wider ${
                                                        isAllowed ? 'text-green-600' :
                                                        isBlocked ? 'text-red-600' : 'text-orange-600'
                                                    }`}>
                                                        {decision || '-'}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-3 font-mono text-xs text-text-muted max-w-[200px] truncate" title={c.safety?.reason_code}>
                                                {c.safety?.reason_code || '-'}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};
