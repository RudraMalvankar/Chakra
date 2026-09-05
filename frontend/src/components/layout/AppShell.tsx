import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { Badge } from '../ui/Badge';

export const AppShell = ({ children, data }: any) => {
    const location = useLocation();
    const navigate = useNavigate();
    
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
                <header className="h-16 bg-white border-b border-border flex items-center justify-between px-6 shrink-0 shadow-sm z-10">
                    <div className="flex items-center">
                        <h2 className="text-sm font-bold uppercase tracking-widest text-text-main flex items-center">
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
                    <div className="text-[10px] font-mono uppercase tracking-widest text-text-muted">Operational data refreshes on demand</div>
                </header>

                <main className="flex-1 overflow-y-auto p-6 bg-background">
                    {children}
                </main>
            </div>
        </div>
    );
};
