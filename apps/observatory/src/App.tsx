import { Routes, Route } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { DashboardPage } from './pages/DashboardPage';
import { AgentsPage } from './pages/AgentsPage';
import { AgentDetailPage } from './pages/AgentDetailPage';
import { GraphPage } from './pages/GraphPage';
import { ProvenancePage } from './pages/ProvenancePage';
import { ToolsPage } from './pages/ToolsPage';
import { VerifyPage } from './pages/VerifyPage';
import { EscalationsPage } from './pages/EscalationsPage';

export const App: React.FC = () => (
  <ErrorBoundary>
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/agents/:name" element={<AgentDetailPage />} />
        <Route path="/tools" element={<ToolsPage />} />
        <Route path="/escalations" element={<EscalationsPage />} />
        <Route path="/graph" element={<GraphPage />} />
        <Route path="/provenance" element={<ProvenancePage />} />
        <Route path="/verify" element={<VerifyPage />} />
      </Route>
    </Routes>
  </ErrorBoundary>
);
