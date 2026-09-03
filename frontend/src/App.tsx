import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { useChakraData } from './hooks/useChakraData';
import { CommandCenter } from './pages/CommandCenter';
import { Simulator } from './pages/Simulator';
import { Opportunities } from './pages/Opportunities';
import { Cases } from './pages/Cases';
import { CaseDetail } from './pages/CaseDetail';
import { Recovery } from './pages/Recovery';
import { Safety } from './pages/Safety';
import { Analytics } from './pages/Analytics';
import { AuditLog } from './pages/AuditLog';
import { AppShell } from './components/layout/AppShell';

export default function App() {
  const data = useChakraData();

  if (data.loading) return <div className="flex h-screen items-center justify-center bg-background text-text-main font-mono">Loading Chakra Engine...</div>;
  if (data.error) return (
      <div className="flex h-screen items-center justify-center bg-background flex-col">
          <div className="text-red-500 mb-4">Error</div>
          <h2 className="text-xl font-bold text-text-main mb-2 font-mono uppercase tracking-wider">Backend unavailable</h2>
          <p className="text-text-muted mb-4 font-mono text-sm">{data.error}</p>
          <button onClick={() => window.location.reload()} className="px-6 py-2 bg-text-main text-white text-xs font-bold uppercase tracking-widest hover:bg-black transition-colors">Retry Connection</button>
      </div>
  );

  return (
    <BrowserRouter>
      <AppShell data={data}>
        <Routes>
          <Route path="/" element={<CommandCenter {...data} />} />
          <Route path="/simulator" element={<Simulator {...data} />} />
          <Route path="/opportunities" element={<Opportunities {...data} />} />
          <Route path="/cases" element={<Cases {...data} />} />
          <Route path="/cases/:id" element={<CaseDetail {...data} />} />
          <Route path="/recovery" element={<Recovery {...data} />} />
          <Route path="/safety" element={<Safety {...data} />} />
          <Route path="/analytics" element={<Analytics {...data} />} />
          <Route path="/audit" element={<AuditLog {...data} />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}
