import { useReducer, useEffect, useCallback } from 'react';
import { fetchAuditLog, fetchCases, fetchMetrics } from '../services/api';
import type { Case, Metrics } from '../types';

type ChakraDataState = {
    auditLog: any[];
    cases: Case[];
    backendMetrics: Metrics | null;
    loading: boolean;
    error: string | null;
    partialErrors: {
        audit?: string;
        metrics?: string;
        cases?: string;
    };
};

type ChakraDataAction =
    | {
          type: 'loaded';
          auditLog: any[];
          cases: Case[];
          metrics: Metrics | null;
          partialErrors: ChakraDataState['partialErrors'];
      }
    | { type: 'boot_failed'; error: string };

function chakraDataReducer(state: ChakraDataState, action: ChakraDataAction): ChakraDataState {
    if (action.type === 'boot_failed') {
        return { ...state, loading: false, error: action.error };
    }
    return {
        auditLog: action.auditLog,
        cases: action.cases,
        backendMetrics: action.metrics,
        loading: false,
        error: null,
        partialErrors: action.partialErrors,
    };
}

function normalizeCases(caseRows: any[]): Case[] {
    return caseRows.map((item: any) => ({
        ...item,
        type: item.case_type ?? item.type,
        amount: item.amount_at_risk ?? item.amount,
        last_updated: item.last_updated || item.created_at,
        events: item.events ?? [],
        risk: item.risk,
        agent: item.agent,
        safety: item.safety,
        outcome: item.outcome,
        ai: item.ai ?? {
            used: item.ai_used,
            classification: item.ai_classification,
            confidence: item.ai_confidence,
            reasoning: item.ai_reasoning,
            fallback_used: item.ai_fallback_used,
        },
    }));
}

export const useChakraData = () => {
    const [{ auditLog, cases, backendMetrics, loading, error, partialErrors }, dispatch] = useReducer(
        chakraDataReducer,
        {
            auditLog: [],
            cases: [],
            backendMetrics: null,
            loading: true,
            error: null,
            partialErrors: {},
        },
    );

    const refresh = useCallback(async () => {
        const results = await Promise.allSettled([
            fetchAuditLog(500),
            fetchMetrics(),
            fetchCases(100),
        ]);

        const partial: ChakraDataState['partialErrors'] = {};
        let events: any[] = [];
        let metrics: Metrics | null = null;
        let caseRows: any[] = [];

        if (results[0].status === 'fulfilled') {
            events = results[0].value;
        } else {
            partial.audit =
                results[0].reason instanceof Error
                    ? results[0].reason.message
                    : 'Unable to load audit log';
        }

        if (results[1].status === 'fulfilled') {
            const m = results[1].value as any;
            metrics = m?.metrics ? m.metrics : m;
        } else {
            partial.metrics =
                results[1].reason instanceof Error
                    ? results[1].reason.message
                    : 'Unable to load metrics';
        }

        if (results[2].status === 'fulfilled') {
            caseRows = Array.isArray(results[2].value) ? results[2].value : [];
        } else {
            partial.cases =
                results[2].reason instanceof Error
                    ? results[2].reason.message
                    : 'Unable to load cases';
        }

        // Only hard-fail the shell when every core endpoint failed (likely backend down).
        if (results.every((r) => r.status === 'rejected')) {
            dispatch({
                type: 'boot_failed',
                error:
                    'Unable to load live recovery data. Is the backend running on port 8001?',
            });
            return;
        }

        dispatch({
            type: 'loaded',
            auditLog: events,
            cases: normalizeCases(caseRows),
            metrics,
            partialErrors: partial,
        });
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
        partialErrors,
        refresh,
    };
};
