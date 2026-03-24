import { Routes, Route, Navigate } from 'react-router-dom';
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
import { AuditPage } from './pages/AuditPage';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';
import { useAuth } from './hooks/useAuth';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export const App: React.FC = () => (
  <ErrorBoundary>
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />

      {/* Protected routes */}
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/agents/:name" element={<AgentDetailPage />} />
        <Route path="/tools" element={<ToolsPage />} />
        <Route path="/escalations" element={<EscalationsPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/graph" element={<GraphPage />} />
        <Route path="/provenance" element={<ProvenancePage />} />
        <Route path="/verify" element={<VerifyPage />} />
      </Route>
    </Routes>
  </ErrorBoundary>
);
