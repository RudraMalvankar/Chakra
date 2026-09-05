import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useChakraData } from './hooks/useChakraData';
import { CommandCenter } from './pages/CommandCenter';
import { ScenarioLab } from './pages/ScenarioLab';
import { Batch } from './pages/Batch';
import { Gateway } from './pages/Gateway';
import { Opportunities } from './pages/Opportunities';
import { Cases } from './pages/Cases';
import { CaseDetail } from './pages/CaseDetail';
import { CheckoutRecovery } from './pages/CheckoutRecovery';
import { Receivables } from './pages/Receivables';
import { PromiseToPay } from './pages/PromiseToPay';
import { VoiceRecovery } from './pages/VoiceRecovery';
import { Safety } from './pages/Safety';
import { Analytics } from './pages/Analytics';
import { AuditLog } from './pages/AuditLog';
import { Recovery } from './pages/Recovery';
import { Escalations } from './pages/Escalations';
import { EscalationDetail } from './pages/EscalationDetail';
import { AppShell } from './components/layout/AppShell';

export default function App() {
  const data = useChakraData();

  if (data.loading) return <div className="flex h-screen items-center justify-center bg-background text-text-main font-mono">Loading Chakra Engine...</div>;
  if (data.error) return (
      <div className="flex h-screen items-center justify-center bg-background flex-col">
          <div className="text-red-500 mb-4">Error</div>
          <h2 className="text-xl font-bold text-text-main mb-2 font-mono uppercase tracking-wider">Backend unavailable</h2>
          <p className="text-text-muted mb-4 font-mono text-sm">{data.error}</p>
          <button onClick={() => data.refresh()} className="px-6 py-2 bg-text-main text-white text-xs font-bold uppercase tracking-widest hover:bg-black transition-colors">Retry Connection</button>
      </div>
  );

  return (
    <BrowserRouter>
      <AppShell data={data}>
        {data.partialErrors && Object.keys(data.partialErrors).length > 0 && (
          <div className="mx-4 mt-2 bg-amber-50 border border-amber-200 text-amber-900 text-xs font-mono px-4 py-2 flex justify-between items-center gap-4">
            <span>
              Partial data load:{' '}
              {Object.entries(data.partialErrors)
                .map(([k, v]) => `${k}: ${v}`)
                .join(' · ')}
            </span>
            <button onClick={() => data.refresh()} className="underline font-bold uppercase tracking-wider whitespace-nowrap">
              Retry
            </button>
          </div>
        )}
        <Routes>
          <Route path="/" element={<CommandCenter {...data} />} />
          <Route path="/opportunities" element={<Opportunities {...data} />} />
          <Route path="/cases" element={<Cases {...data} />} />
          <Route path="/cases/:id" element={<CaseDetail {...data} />} />
          <Route path="/recovery" element={<Recovery {...data} />} />
          <Route path="/escalations" element={<Escalations />} />
          <Route path="/escalations/:id" element={<EscalationDetail />} />
          
          <Route path="/checkout-recovery" element={<CheckoutRecovery {...data} />} />
          <Route path="/receivables" element={<Receivables {...data} />} />
          <Route path="/promise-to-pay" element={<PromiseToPay {...data} />} />
          <Route path="/voice-recovery" element={<VoiceRecovery {...data} />} />

          <Route path="/scenario-lab" element={<ScenarioLab {...data} />} />
          <Route path="/gateway" element={<Gateway />} />
          <Route path="/batch" element={<Batch />} />
          
          <Route path="/safety" element={<Safety {...data} />} />
          <Route path="/analytics" element={<Analytics {...data} />} />
          <Route path="/audit" element={<AuditLog {...data} />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}
