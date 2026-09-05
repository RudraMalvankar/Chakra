import { useState, useEffect, useCallback } from 'react';
import { fetchAuditLog, fetchCases, fetchMetrics } from '../services/api';
import type { Case, Metrics } from '../types';

export const useChakraData = () => {
    const [auditLog, setAuditLog] = useState<any[]>([]);
    const [cases, setCases] = useState<Case[]>([]);
    const [backendMetrics, setBackendMetrics] = useState<Metrics | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    
    const refresh = useCallback(async () => {
        try {
            const [events, metricsResponse, caseRows] = await Promise.all([
                fetchAuditLog(2000),
                fetchMetrics(),
                fetchCases(),
            ]);
            setAuditLog(events);
            setCases(caseRows.map((item: any) => ({
                ...item,
                type: item.case_type,
                amount: item.amount_at_risk,
                last_updated: item.last_updated || item.created_at,
                events: [],
            })));
            setBackendMetrics((metricsResponse as any).metrics ? (metricsResponse as any).metrics : metricsResponse);
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
    }, [refresh]);

    return {
        metrics: backendMetrics,
        auditLog,
        cases,
        loading,
        error,
        refresh,
    };
};
