import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Play, Pause, RotateCcw, Search, Settings, ChevronRight, Activity } from 'lucide-react';
import { Badge } from '../ui/Badge';

export const AppShell = ({ children, data }: any) => {
    const location = useLocation();
    const navigate = useNavigate();
    
    const { demoMode, setDemoMode, demoIndex, setDemoIndex, isPlaying, setIsPlaying, totalEvents } = data;

    const navGroups = [
        { title: 'MAIN', items: [{ path: '/', label: 'Command Center' }] },
        { title: 'OPERATE', items: [{ path: '/opportunities', label: 'Opportunities' }, { path: '/cases', label: 'Cases' }, { path: '/recovery', label: 'Recovery' }] },
        { title: 'SIMULATOR', items: [{ path: '/simulator', label: 'Create Payment' }, { path: '/gateway', label: 'Gateway Console' }, { path: '/batch', label: 'Batch Simulator' }] },
        { title: 'CONTROL', items: [{ path: '/safety', label: 'Safety' }, { path: '/analytics', label: 'Analytics' }, { path: '/audit', label: 'Audit Log' }] }
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
                                    className={`block w-full text-left px-6 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${location.pathname === t.path || (location.pathname.startsWith('/cases/') && t.path === '/cases') ? 'text-rzp-blue bg-blue-50/50 border-r-2 border-rzp-blue' : 'text-text-muted hover:bg-gray-50 hover:text-text-main border-r-2 border-transparent'}`}
                                >
                                    {t.label}
                                </Link>
                            ))}
                        </div>
                    ))}
                </nav>
                <div className="p-6 border-t border-border bg-gray-50">
                    <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-2">Environment</div>
                    <Badge status="INFO" className="w-full justify-center py-1">SYNTHETIC DEMO</Badge>
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
                    <div className="flex items-center space-x-4">
                        <div className="relative">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                            <input type="text" placeholder="Search..." className="pl-8 pr-4 py-1.5 border border-border rounded text-xs font-mono bg-gray-50 focus:bg-white focus:outline-none focus:border-rzp-blue focus:ring-1 focus:ring-rzp-blue transition-colors w-48" />
                        </div>
                        
                        <div className="w-px h-6 bg-border"></div>
                        
                        <div className="flex items-center space-x-1 border border-border rounded overflow-hidden bg-gray-50">
                            <button 
                                onClick={() => {
                                    if (!demoMode) { setDemoMode(true); setDemoIndex(0); setIsPlaying(true); }
                                    else { setDemoMode(false); setIsPlaying(false); }
                                }}
                                className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest flex items-center space-x-1 ${demoMode ? 'bg-blue-50 text-rzp-blue' : 'hover:bg-gray-100 text-text-muted'}`}
                            >
                                <span className={`w-1.5 h-1.5 rounded-full ${demoMode && isPlaying ? 'bg-rzp-blue animate-pulse' : 'bg-gray-400'}`}></span>
                                <span>Live Demo</span>
                            </button>
                            
                            {demoMode && (
                                <>
                                    <button onClick={() => setIsPlaying(!isPlaying)} className="px-2 py-1.5 hover:bg-gray-100 text-text-muted border-l border-border" title="Play/Pause">
                                        {isPlaying ? <Pause size={14} /> : <Play size={14} />}
                                    </button>
                                    <button onClick={() => { setDemoIndex(0); setIsPlaying(true); }} className="px-2 py-1.5 hover:bg-gray-100 text-text-muted border-l border-border" title="Restart">
                                        <RotateCcw size={14} />
                                    </button>
                                    <div className="px-2 py-1.5 border-l border-border text-[10px] font-mono text-text-muted bg-white min-w-[60px] text-center">
                                        {demoIndex} / {totalEvents}
                                    </div>
                                </>
                            )}
                        </div>

                        <button className="text-text-muted hover:text-text-main p-1.5 rounded hover:bg-gray-100 transition-colors">
                            <Settings size={16} />
                        </button>
                    </div>
                </header>

                <main className="flex-1 overflow-y-auto p-6 bg-background">
                    {children}
                </main>
            </div>
        </div>
    );
};
