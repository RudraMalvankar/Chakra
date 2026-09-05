import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronRight, Search, Settings, X } from 'lucide-react';
import { Badge } from '../ui/Badge';
import { fetchHealth, fetchConfig } from '../../services/api';

export const AppShell = ({ children, data }: any) => {
    const location = useLocation();
    const navigate = useNavigate();
    const [query, setQuery] = useState('');
    const [searchError, setSearchError] = useState<string | null>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [health, setHealth] = useState<any>(null);
    const [providerMode, setProviderMode] = useState<string | null>(null);
    const [healthError, setHealthError] = useState<string | null>(null);
    const [healthLoading, setHealthLoading] = useState(false);

    const navGroups = [
        { title: 'MAIN', items: [{ path: '/', label: 'Command Center' }] },
        { title: 'RECOVERY', items: [{ path: '/opportunities', label: 'Opportunities' }, { path: '/cases', label: 'Cases' }, { path: '/recovery', label: 'Recovery' }, { path: '/escalations', label: 'Escalations' }] },
        { title: 'WORKFLOWS', items: [
            { path: '/checkout-recovery', label: 'Checkout Recovery' },
            { path: '/receivables', label: 'Receivables' },
            { path: '/promise-to-pay', label: 'Promise-to-Pay' },
            { path: '/voice-recovery', label: 'Voice Recovery' }
        ]},
        { title: 'SIMULATION', items: [
            { path: '/scenario-lab', label: 'Scenario Lab' },
            { path: '/gateway', label: 'Gateway Console' },
            { path: '/batch', label: 'Batch Simulator' }
        ]},
        { title: 'CONTROL', items: [
            { path: '/safety', label: 'Safety & Policies' },
            { path: '/analytics', label: 'Analytics' },
            { path: '/audit', label: 'Audit Log' }
        ]}
    ];

    const runSearch = (e?: React.FormEvent) => {
        e?.preventDefault();
        const q = query.trim().toLowerCase();
        setSearchError(null);
        if (!q) return;
        const cases = Array.isArray(data?.cases) ? data.cases : [];
        const match = cases.find((c: any) => {
            const id = String(c.id || c.case_id || '').toLowerCase();
            const paymentId = String(c.payment_id || '').toLowerCase();
            return id === q || id.startsWith(q) || paymentId === q || paymentId.startsWith(q);
        });
        if (match) {
            navigate(`/cases/${match.id || match.case_id}`);
            setQuery('');
        } else {
            setSearchError('Case not found');
        }
    };

    useEffect(() => {
        if (!settingsOpen) return;
        let cancelled = false;
        setHealthLoading(true);
        setHealthError(null);
        Promise.allSettled([fetchHealth(), fetchConfig()])
            .then(([h, c]) => {
                if (cancelled) return;
                if (h.status === 'fulfilled') setHealth(h.value);
                else setHealthError(h.reason instanceof Error ? h.reason.message : 'Health unavailable');
                if (c.status === 'fulfilled') {
                    setProviderMode(`${c.value.provider || 'unknown'} / ${c.value.mode || 'unknown'}`);
                }
            })
            .finally(() => {
                if (!cancelled) setHealthLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [settingsOpen]);

    return (
        <div className="flex h-screen overflow-hidden bg-background">
            <div className="w-64 bg-white border-r border-border flex flex-col shrink-0">
                <div className="p-6 border-b border-border bg-gray-50 flex items-center">
                    <div className="w-3 h-3 rounded-full bg-rzp-red mr-3"></div>
                    <h1 className="font-bold tracking-widest text-lg text-text-main uppercase">CHAKRA</h1>
                </div>
                <nav className="flex-1 overflow-y-auto py-4 flex flex-col space-y-6">
                    {navGroups.map(g => (
                        <div key={g.title}>
                            <div className="px-6 text-[10px] font-bold text-text-light uppercase tracking-widest mb-2">{g.title}</div>
                            {g.items.map(t => (
                                <Link
                                    key={t.path}
                                    to={t.path}
                                    className={`block w-full text-left px-6 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${location.pathname === t.path ? 'text-rzp-blue bg-blue-50/50 border-r-2 border-rzp-blue' : 'text-text-muted hover:bg-gray-50 hover:text-text-main border-r-2 border-transparent'}`}
                                >
                                    {t.label}
                                </Link>
                            ))}
                        </div>
                    ))}
                </nav>
                <div className="p-6 border-t border-border bg-gray-50">
                    <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-2">Environment</div>
                    <Badge status="INFO" className="w-full justify-center py-1">BACKEND-DRIVEN</Badge>
                </div>
            </div>

            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                <header className="h-16 bg-white border-b border-border flex items-center justify-between px-6 shrink-0 shadow-sm z-10 gap-4">
                    <div className="flex items-center min-w-0">
                        <h2 className="text-sm font-bold uppercase tracking-widest text-text-main flex items-center truncate">
                            {location.pathname.startsWith('/cases/') ? (
                                <>
                                    <span className="cursor-pointer hover:text-text-muted transition-colors" onClick={() => navigate('/cases')}>CASES</span>
                                    <ChevronRight size={14} className="mx-2 text-text-muted" />
                                    <span>CASE {location.pathname.split('/').pop()?.substring(0,8)}</span>
                                </>
                            ) : (
                                navGroups.flatMap(g => g.items).find(i => i.path === location.pathname)?.label || 'CHAKRA'
                            )}
                        </h2>
                    </div>
                    <div className="flex items-center gap-3">
                        <form onSubmit={runSearch} className="relative flex items-center">
                            <Search size={14} className="absolute left-2.5 text-text-muted pointer-events-none" />
                            <input
                                type="text"
                                value={query}
                                onChange={(e) => { setQuery(e.target.value); setSearchError(null); }}
                                placeholder="Case / payment ID"
                                className="border border-border rounded pl-8 pr-3 py-1.5 text-xs font-mono w-48 focus:outline-none focus:border-rzp-blue"
                            />
                            {searchError && (
                                <span className="absolute right-0 top-full mt-1 text-[10px] font-mono text-rzp-red whitespace-nowrap">{searchError}</span>
                            )}
                        </form>
                        <button
                            type="button"
                            onClick={() => setSettingsOpen(true)}
                            className="p-2 text-text-muted hover:text-text-main hover:bg-gray-50 rounded"
                            aria-label="Settings"
                        >
                            <Settings size={16} />
                        </button>
                    </div>
                </header>

                <main className="flex-1 overflow-y-auto p-6 bg-background">
                    {children}
                </main>
            </div>

            {settingsOpen && (
                <div className="fixed inset-0 z-50 flex justify-end">
                    <div className="absolute inset-0 bg-black/20" onClick={() => setSettingsOpen(false)} />
                    <aside className="relative w-full max-w-sm bg-white border-l border-border shadow-lg h-full p-6 overflow-y-auto">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-sm font-bold uppercase tracking-widest text-text-main">Settings</h3>
                            <button type="button" onClick={() => setSettingsOpen(false)} className="p-1 text-text-muted hover:text-text-main" aria-label="Close">
                                <X size={16} />
                            </button>
                        </div>
                        {healthLoading && <div className="text-xs font-mono text-text-muted">Loading health…</div>}
                        {healthError && <div className="text-xs font-mono text-rzp-red mb-4">{healthError}</div>}
                        {!healthLoading && health && (
                            <dl className="space-y-4 text-sm font-mono">
                                <div>
                                    <dt className="text-[10px] uppercase text-text-muted font-bold tracking-wider">Environment</dt>
                                    <dd className="text-text-main mt-1">{health.status || 'unknown'}</dd>
                                </div>
                                <div>
                                    <dt className="text-[10px] uppercase text-text-muted font-bold tracking-wider">Provider Mode</dt>
                                    <dd className="text-text-main mt-1">{providerMode || 'unknown'}</dd>
                                </div>
                                <div>
                                    <dt className="text-[10px] uppercase text-text-muted font-bold tracking-wider">Gemini</dt>
                                    <dd className="text-text-main mt-1">{health.gemini}</dd>
                                </div>
                                <div>
                                    <dt className="text-[10px] uppercase text-text-muted font-bold tracking-wider">Razorpay</dt>
                                    <dd className="text-text-main mt-1">{health.razorpay}</dd>
                                </div>
                                <div>
                                    <dt className="text-[10px] uppercase text-text-muted font-bold tracking-wider">Twilio</dt>
                                    <dd className="text-text-main mt-1">{health.twilio}</dd>
                                </div>
                                <div>
                                    <dt className="text-[10px] uppercase text-text-muted font-bold tracking-wider">Database</dt>
                                    <dd className="text-text-main mt-1">{health.database}</dd>
                                </div>
                            </dl>
                        )}
                        <p className="mt-8 text-[10px] text-text-muted font-mono">Status flags only — no secrets or API keys are shown.</p>
                    </aside>
                </div>
            )}
        </div>
    );
};
