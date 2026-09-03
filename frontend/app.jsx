const { useState } = React;

const App = () => {
    const { 
        metrics, auditLog, cases, loading, error, 
        demoMode, setDemoMode, demoIndex, setDemoIndex,
        isPlaying, setIsPlaying, totalEvents
    } = useChakraData();
    
    const [currentTab, setCurrentTab] = useState('Command Center');
    const [selectedCaseId, setSelectedCaseId] = useState(null);

    const tabs = ['Command Center', 'Opportunities', 'Cases', 'Recovery', 'Safety', 'Analytics', 'Audit Log'];

    if (loading) return <div className="flex h-screen items-center justify-center bg-background text-text-main font-mono">Loading Chakra Engine...</div>;
    if (error) return (
        <div className="flex h-screen items-center justify-center bg-background flex-col">
            <div className="text-red-500 mb-4"><Icon name="alert-triangle" size={48} /></div>
            <h2 className="text-xl font-bold text-text-main mb-2 font-mono uppercase tracking-wider">Backend unavailable</h2>
            <p className="text-text-muted mb-4 font-mono text-sm">{error}</p>
            <button onClick={() => window.location.reload()} className="px-6 py-2 bg-text-main text-white text-xs font-bold uppercase tracking-widest hover:bg-black transition-colors">Retry Connection</button>
        </div>
    );

    const viewCase = (id) => setSelectedCaseId(id);

    return (
        <div className="flex h-screen overflow-hidden bg-background">
            {/* Sidebar */}
            <div className="w-64 bg-white border-r border-border flex flex-col shrink-0">
                <div className="p-6 border-b border-border bg-gray-50 flex items-center">
                    <div className="w-3 h-3 rounded-full bg-rzp-red mr-3"></div>
                    <h1 className="font-bold tracking-widest text-lg text-text-main uppercase">CHAKRA</h1>
                </div>
                <nav className="flex-1 py-4 flex flex-col">
                    {tabs.map(t => (
                        <button
                            key={t}
                            onClick={() => { setCurrentTab(t); setSelectedCaseId(null); }}
                            className={`w-full text-left px-6 py-3 text-xs font-bold uppercase tracking-wider transition-colors ${currentTab === t && !selectedCaseId ? 'text-rzp-blue bg-blue-50/50 border-r-2 border-rzp-blue' : 'text-text-muted hover:bg-gray-50 hover:text-text-main border-r-2 border-transparent'}`}
                        >
                            {t}
                        </button>
                    ))}
                </nav>
                <div className="p-6 border-t border-border bg-gray-50">
                    <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-2">Environment</div>
                    <Badge status="INFO" className="w-full justify-center py-1">SYNTHETIC DEMO</Badge>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* Topbar */}
                <header className="h-16 bg-white border-b border-border flex items-center justify-between px-6 shrink-0 shadow-sm z-10">
                    <div className="flex items-center">
                        {selectedCaseId ? (
                            <div className="flex items-center text-xs font-bold uppercase tracking-widest text-text-muted">
                                <span className="cursor-pointer hover:text-text-main" onClick={() => setSelectedCaseId(null)}>{currentTab}</span>
                                <Icon name="chevron-right" size={14} className="mx-2" />
                                <span className="text-text-main">CASE {selectedCaseId.substring(0,8)}</span>
                            </div>
                        ) : (
                            <h2 className="text-sm font-bold uppercase tracking-widest text-text-main">{currentTab}</h2>
                        )}
                    </div>
                    <div className="flex items-center space-x-4">
                        <div className="relative">
                            <Icon name="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                            <input type="text" placeholder="Search..." className="pl-8 pr-4 py-1.5 border border-border rounded text-xs font-mono bg-gray-50 focus:bg-white focus:outline-none focus:border-rzp-blue focus:ring-1 focus:ring-rzp-blue transition-colors w-48" />
                        </div>
                        
                        <div className="w-px h-6 bg-border"></div>
                        
                        {/* Demo Controls */}
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
                                        <Icon name={isPlaying ? "pause" : "play"} size={14} />
                                    </button>
                                    <button onClick={() => { setDemoIndex(0); setIsPlaying(true); }} className="px-2 py-1.5 hover:bg-gray-100 text-text-muted border-l border-border" title="Restart">
                                        <Icon name="rotate-ccw" size={14} />
                                    </button>
                                    <div className="px-2 py-1.5 border-l border-border text-[10px] font-mono text-text-muted bg-white min-w-[60px] text-center">
                                        {demoIndex} / {totalEvents}
                                    </div>
                                </>
                            )}
                        </div>

                        <button className="text-text-muted hover:text-text-main p-1.5 rounded hover:bg-gray-100 transition-colors">
                            <Icon name="settings" size={16} />
                        </button>
                    </div>
                </header>

                {/* Main Scrollable Area */}
                <main className="flex-1 overflow-y-auto p-6 bg-background">
                    {selectedCaseId ? (
                        <CaseDetail caseData={cases.find(c => c.id === selectedCaseId)} onBack={() => setSelectedCaseId(null)} />
                    ) : (
                        <>
                            {currentTab === 'Command Center' && <CommandCenter metrics={metrics} auditLog={auditLog} cases={cases} onViewCase={viewCase} />}
                            {currentTab === 'Opportunities' && <Opportunities cases={cases} onViewCase={viewCase} />}
                            {currentTab === 'Cases' && <Cases cases={cases} onViewCase={viewCase} />}
                            {currentTab === 'Recovery' && <Recovery metrics={metrics} />}
                            {currentTab === 'Safety' && <SafetyCenter cases={cases} metrics={metrics} onViewCase={viewCase} />}
                            {currentTab === 'Analytics' && <Analytics metrics={metrics} />}
                            {currentTab === 'Audit Log' && <AuditLog auditLog={auditLog} onViewCase={viewCase} />}
                        </>
                    )}
                </main>
            </div>
        </div>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
