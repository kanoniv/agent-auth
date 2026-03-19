import { Routes, Route } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { DashboardPage } from './pages/DashboardPage';
import { AgentsPage } from './pages/AgentsPage';
import { AgentDetailPage } from './pages/AgentDetailPage';
import { GraphPage } from './pages/GraphPage';
import { ProvenancePage } from './pages/ProvenancePage';
import { ChatPage } from './pages/ChatPage';
import { InteropPage } from './pages/InteropPage';

export const App: React.FC = () => (
  <ErrorBoundary>
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/agents/:name" element={<AgentDetailPage />} />
        <Route path="/graph" element={<GraphPage />} />
        <Route path="/provenance" element={<ProvenancePage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/interop" element={<InteropPage />} />
      </Route>
    </Routes>
  </ErrorBoundary>
);
