const { useState, useEffect, useMemo, useCallback } = React;
const API_BASE = 'http://localhost:8001';

// Centralized metrics computer. This ensures we never fake stats or have inconsistent UI.
const computeMetrics = (casesList) => {
    let at_risk = 0;
    let recovered = 0;
    let blocked = 0;
    let escalated = 0;
    let attempted = 0; // expected recovery of attempted
    let successCount = 0;
    let blockedCount = 0;
    let escalatedCount = 0;
    
    let by_case = {
        'PAYMENT_FAILURE': { processed: 0, recovered: 0, at_risk: 0, recovered_inr: 0 },
        'SUBSCRIPTION': { processed: 0, recovered: 0, at_risk: 0, recovered_inr: 0 },
        'CHECKOUT_ABANDONMENT': { processed: 0, recovered: 0, at_risk: 0, recovered_inr: 0 },
        'RECEIVABLE': { processed: 0, recovered: 0, at_risk: 0, recovered_inr: 0 },
        'PROMISE_TO_PAY': { processed: 0, recovered: 0, at_risk: 0, recovered_inr: 0 }
    };
    
    let by_intervention = {
        'PAYMENT_LINK': { attempted: 0, succeeded: 0, recovered_inr: 0 },
        'AFA_PAYMENT_LINK': { attempted: 0, succeeded: 0, recovered_inr: 0 },
        'RETRY_NOW': { attempted: 0, succeeded: 0, recovered_inr: 0 },
        'RETRY_LATER': { attempted: 0, succeeded: 0, recovered_inr: 0 },
        'VOICE_RECOVERY': { attempted: 0, succeeded: 0, recovered_inr: 0 },
        'REMINDER': { attempted: 0, succeeded: 0, recovered_inr: 0 }
    };

    casesList.forEach(c => {
        if (c.amount) at_risk += c.amount;
        
        let act = null;
        if (c.agent && c.agent.selected_action && c.agent.selected_action !== 'BLOCK' && c.agent.selected_action !== 'ESCALATE') {
            act = c.agent.selected_action;
        }

        if (c.status === 'RECOVERED') {
            recovered += c.outcome?.amount_recovered_inr || c.amount || 0;
            successCount++;
        } else if (c.status === 'BLOCKED') {
            blocked += c.amount || 0;
            blockedCount++;
        } else if (c.status === 'ESCALATED') {
            escalated += c.amount || 0;
            escalatedCount++;
        }
        
        if (act && c.safety && c.safety.eligibility === 'ALLOWED') {
            const exp = c.agent.candidate_actions?.find(ca => ca.action === act)?.expected_recovery_inr || 0;
            attempted += exp;
            
            if (by_intervention[act]) {
                by_intervention[act].attempted++;
                if (c.status === 'RECOVERED') {
                    by_intervention[act].succeeded++;
                    by_intervention[act].recovered_inr += c.outcome?.amount_recovered_inr || c.amount || 0;
                }
            }
        }
        
        if (c.type && by_case[c.type]) {
            by_case[c.type].processed++;
            by_case[c.type].at_risk += c.amount || 0;
            if (c.status === 'RECOVERED') {
                by_case[c.type].recovered++;
                by_case[c.type].recovered_inr += c.outcome?.amount_recovered_inr || c.amount || 0;
            }
        }
    });

    return {
        revenue_at_risk_inr: at_risk,
        revenue_recovered_inr: recovered,
        revenue_recovery_rate_pct: at_risk > 0 ? (recovered / at_risk) * 100 : 0,
        revenue_attempted_inr: attempted, // This is Expected Recovery of allowed cases
        revenue_blocked_inr: blocked,
        revenue_escalated_inr: escalated,
        payments_processed: casesList.length,
        payments_recovered: successCount,
        payments_blocked: blockedCount,
        payments_escalated: escalatedCount,
        by_case_type: by_case,
        by_intervention: by_intervention
    };
};

const useChakraData = () => {
    const [rawAuditLog, setRawAuditLog] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    
    // Live Demo State
    const [demoMode, setDemoMode] = useState(false);
    const [demoIndex, setDemoIndex] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);

    const refresh = useCallback(() => {
        fetch(`${API_BASE}/api/audit?limit=2000`)
            .then(r => r.json())
            .then(a => {
                setRawAuditLog(a.events || []);
                setLoading(false);
                setError(null);
            })
            .catch(err => {
                console.error(err);
                setError("Unable to load live recovery data. Is the backend running?");
                setLoading(false);
            });
    }, []);

    useEffect(() => {
        refresh();
        const int = setInterval(refresh, 5000);
        return () => clearInterval(int);
    }, [refresh]);

    useEffect(() => {
        if (demoMode && isPlaying && demoIndex < rawAuditLog.length) {
            const timer = setTimeout(() => setDemoIndex(i => i + 1), 150); // Replay speed
            return () => clearTimeout(timer);
        } else if (demoIndex >= rawAuditLog.length) {
            setIsPlaying(false);
        }
    }, [demoMode, isPlaying, demoIndex, rawAuditLog.length]);

    const activeAuditLog = useMemo(() => {
        if (!demoMode) return rawAuditLog;
        return rawAuditLog.slice(0, demoIndex);
    }, [rawAuditLog, demoMode, demoIndex]);

    const cases = useMemo(() => {
        const caseMap = {};
        const getOrAdd = (id) => {
            if (!caseMap[id]) caseMap[id] = { id, events: [], amount: 0, status: 'PENDING', type: 'UNKNOWN', risk: null, agent: null, safety: null, outcome: null };
            return caseMap[id];
        };
        
        const sortedEvents = [...activeAuditLog].sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
        
        sortedEvents.forEach(ev => {
            const c = getOrAdd(ev.payment_id);
            c.events.push(ev);
            c.last_updated = ev.timestamp;
            
            if (ev.event_type === 'revenue_risk_assessed') {
                c.risk = ev.details;
                c.amount = ev.details.revenue_at_risk_inr;
            } else if (ev.event_type === 'agent_decision_proposed') {
                c.agent = ev.details;
                c.type = ev.details.case_type || c.type;
            } else if (ev.event_type === 'safety_check_completed') {
                c.safety = ev.details;
                if (ev.details.decision === 'BLOCK' || ev.details.eligibility === 'BLOCKED') c.status = 'BLOCKED';
                else if (ev.details.decision === 'ESCALATE' || ev.details.eligibility === 'ESCALATED') c.status = 'ESCALATED';
            } else if (ev.event_type === 'execution_outcome') {
                c.outcome = ev.details;
                if (ev.details.recovered) c.status = 'RECOVERED';
                else c.status = 'FAILED';
            } else if (ev.event_type === 'execution_blocked') {
                c.status = 'BLOCKED';
            } else if (ev.event_type === 'execution_escalated') {
                c.status = 'ESCALATED';
            } else if (ev.event_type === 'retry_scheduled' || ev.event_type.includes('generated')) {
                if (c.status === 'PENDING') c.status = 'RECOVERY_PENDING';
            }
        });
        
        return Object.values(caseMap).sort((a,b) => {
            const expectedA = a.agent?.candidate_actions?.find(ca => ca.action === a.agent.selected_action)?.expected_recovery_inr || 0;
            const expectedB = b.agent?.candidate_actions?.find(ca => ca.action === b.agent.selected_action)?.expected_recovery_inr || 0;
            return expectedB - expectedA; // DESC
        });
    }, [activeAuditLog]);

    const metrics = useMemo(() => computeMetrics(cases), [cases]);

    return { 
        metrics, 
        auditLog: activeAuditLog, 
        cases, 
        loading, 
        error, 
        demoMode, 
        setDemoMode, 
        demoIndex, 
        setDemoIndex,
        isPlaying,
        setIsPlaying,
        totalEvents: rawAuditLog.length
    };
};
