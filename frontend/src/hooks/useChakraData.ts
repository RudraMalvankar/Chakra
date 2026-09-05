import { useReducer, useEffect, useCallback } from 'react';
import { fetchAuditLog, fetchCases, fetchMetrics } from '../services/api';
import type { Case, Metrics } from '../types';

type ChakraDataState = {
    auditLog: any[];
    cases: Case[];
    backendMetrics: Metrics | null;
    loading: boolean;
    error: string | null;
};
type ChakraDataAction =
    | { type: 'loaded'; auditLog: any[]; cases: Case[]; metrics: Metrics }
    | { type: 'failed'; error: string };
function chakraDataReducer(state: ChakraDataState, action: ChakraDataAction): ChakraDataState {
    return action.type === 'loaded'
        ? { auditLog: action.auditLog, cases: action.cases, backendMetrics: action.metrics, loading: false, error: null }
        : { ...state, loading: false, error: action.error };
}

export const useChakraData = () => {
    const [{ auditLog, cases, backendMetrics, loading, error }, dispatch] = useReducer(chakraDataReducer, {
        auditLog: [], cases: [], backendMetrics: null, loading: true, error: null,
    });
    
    const refresh = useCallback(async () => {
        try {
            const [events, metricsResponse, caseRows] = await Promise.all([
                fetchAuditLog(2000),
                fetchMetrics(),
                fetchCases(),
            ]);
            const normalizedCases = caseRows.map((item: any) => ({
                ...item,
                type: item.case_type,
                amount: item.amount_at_risk,
                last_updated: item.last_updated || item.created_at,
                events: [],
            }));
            dispatch({
                type: 'loaded',
                auditLog: events,
                cases: normalizedCases,
                metrics: (metricsResponse as any).metrics ? (metricsResponse as any).metrics : metricsResponse,
            });
        } catch (err) {
            console.error(err);
            dispatch({ type: 'failed', error: "Unable to load live recovery data. Is the backend running?" });
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
