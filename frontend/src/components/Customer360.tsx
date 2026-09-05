import { API_BASE } from '../services/api';
import React, { useEffect, useState } from 'react';
import { formatCurrency } from '../lib/format';
import { Badge } from './ui/Badge';

type Props = {
    /** Prefill from case/receivable context when available */
    initialQuery?: string;
};

/**
 * Lightweight customer slice from existing list APIs (receivables + promises).
 * Filters client-side — no dedicated Customer 360 backend.
 */
export const Customer360 = ({ initialQuery = '' }: Props) => {
    const [query, setQuery] = useState(initialQuery);
    const [receivables, setReceivables] = useState<any[]>([]);
    const [promises, setPromises] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setQuery(initialQuery);
    }, [initialQuery]);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        Promise.all([
            fetch(`${API_BASE}/api/receivables`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`receivables ${r.status}`)))),
            fetch(`${API_BASE}/api/receivables/promises`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`promises ${r.status}`)))),
        ])
            .then(([recs, pts]) => {
                if (cancelled) return;
                setReceivables(Array.isArray(recs) ? recs : []);
                setPromises(Array.isArray(pts) ? pts : []);
            })
            .catch((e) => {
                if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to load customer data');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const q = query.trim().toLowerCase();
    const matchedReceivables = q
        ? receivables.filter((r) => {
              const name = String(r.customer || '').toLowerCase();
              const cid = String(r.customer_id || '').toLowerCase();
              return name.includes(q) || cid.includes(q) || cid === q;
          })
        : [];
    const receivableIds = new Set(matchedReceivables.map((r) => r.id));
    const matchedNames = new Set(matchedReceivables.map((r) => String(r.customer || '').toLowerCase()));
    const matchedPromises = q
        ? promises.filter((p) => {
              const name = String(p.customer || p.customer_name || '').toLowerCase();
              return receivableIds.has(p.receivable_id) || matchedNames.has(name) || name.includes(q);
          })
        : [];

    return (
        <div className="bg-white border border-border shadow-sm">
            <div className="px-6 py-4 border-b border-border bg-gray-50">
                <h3 className="text-xs font-bold text-text-main uppercase tracking-wider">Customer 360</h3>
                <p className="text-xs text-text-muted mt-1 font-mono">Filtered from existing receivables and promises lists.</p>
            </div>
            <div className="p-6 space-y-4">
                <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Customer name or customer_id"
                    className="w-full border border-border rounded px-3 py-2 font-mono text-sm"
                />
                {loading && <div className="text-xs font-mono text-text-muted">Loading…</div>}
                {error && <div className="text-xs font-mono text-rzp-red">{error}</div>}
                {!loading && !error && !q && (
                    <div className="text-xs font-mono text-text-muted">Enter a customer to see receivables and promises.</div>
                )}
                {q && !loading && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <div className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-2">
                                Receivables ({matchedReceivables.length})
                            </div>
                            {matchedReceivables.length === 0 ? (
                                <div className="text-xs font-mono text-text-muted">No matching receivables</div>
                            ) : (
                                matchedReceivables.map((r) => (
                                    <div key={r.id} className="text-xs font-mono border border-border p-2 mb-2 flex justify-between gap-2">
                                        <span>
                                            {r.invoice_id || r.id} · {r.customer}
                                            {r.customer_id ? ` · ${r.customer_id}` : ''}
                                        </span>
                                        <span className="shrink-0">
                                            <Badge status={r.status}>{r.status}</Badge> {formatCurrency(r.remaining_amount ?? r.amount)}
                                        </span>
                                    </div>
                                ))
                            )}
                        </div>
                        <div>
                            <div className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-2">
                                Promises ({matchedPromises.length})
                            </div>
                            {matchedPromises.length === 0 ? (
                                <div className="text-xs font-mono text-text-muted">No matching promises</div>
                            ) : (
                                matchedPromises.map((p) => (
                                    <div key={p.id} className="text-xs font-mono border border-border p-2 mb-2 flex justify-between gap-2">
                                        <span>
                                            {p.id} · {p.customer || p.customer_name} · {p.promised_date || p.promised_date}
                                        </span>
                                        <span className="shrink-0">
                                            <Badge status={p.status}>{p.status}</Badge> {formatCurrency(p.amount ?? p.promised_amount)}
                                        </span>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
