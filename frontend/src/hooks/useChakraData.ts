import { useState, useEffect, useMemo, useCallback } from 'react';
import { fetchAuditLog, fetchMetrics } from '../services/api';
import type { Case, Metrics } from '../types';

export const useChakraData = () => {
    const [rawAuditLog, setRawAuditLog] = useState<any[]>([]);
    const [backendMetrics, setBackendMetrics] = useState<Metrics | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    
    // Live Demo State
    const [demoMode, setDemoMode] = useState(false);
    const [demoIndex, setDemoIndex] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);

    const refresh = useCallback(async () => {
        try {
            const [events, metricsResponse] = await Promise.all([
                fetchAuditLog(2000),
                fetchMetrics()
            ]);
            setRawAuditLog(events);
            // @ts-ignore
            setBackendMetrics(metricsResponse.metrics ? metricsResponse.metrics : metricsResponse);
            setLoading(false);
            setError(null);
        } catch (err) {
            console.error(err);
            setError("Unable to load live recovery data. Is the backend running?");
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        refresh();
        const int = setInterval(refresh, 5000);
        return () => clearInterval(int);
    }, [refresh]);

    useEffect(() => {
        if (demoMode && isPlaying && demoIndex < rawAuditLog.length) {
            const timer = setTimeout(() => setDemoIndex(i => i + 1), 150);
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
        const caseMap: Record<string, Case> = {};
        const getOrAdd = (id: string): Case => {
            if (!caseMap[id]) caseMap[id] = { id, events: [], amount: 0, status: 'PENDING', type: 'UNKNOWN', last_updated: '' };
            return caseMap[id];
        };
        
        const sortedEvents = [...activeAuditLog].sort((a,b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        
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
            const expectedA = a.agent?.candidate_actions?.find((ca: any) => ca.action === a.agent.selected_action)?.expected_recovery_inr || 0;
            const expectedB = b.agent?.candidate_actions?.find((ca: any) => ca.action === b.agent.selected_action)?.expected_recovery_inr || 0;
            return expectedB - expectedA;
        });
    }, [activeAuditLog]);

    return { 
        metrics: backendMetrics || {
            revenue_at_risk_inr: 0,
            revenue_recovered_inr: 0,
            revenue_recovery_rate_pct: 0,
            revenue_attempted_inr: 0,
            revenue_blocked_inr: 0,
            revenue_escalated_inr: 0,
            payments_processed: 0,
            payments_recovered: 0,
            payments_blocked: 0,
            payments_escalated: 0,
            by_case_type: {},
            by_intervention: {}
        }, 
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
        totalEvents: rawAuditLog.length,
        refresh
    };
};
