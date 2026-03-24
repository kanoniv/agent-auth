import { Routes, Route, Navigate } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { DashboardPage } from './pages/DashboardPage';
import { AgentsPage } from './pages/AgentsPage';
import { AgentDetailPage } from './pages/AgentDetailPage';
import { EscalationsPage } from './pages/EscalationsPage';
import { AuditPage } from './pages/AuditPage';
import { ClientsPage } from './pages/ClientsPage';
import { SettingsPage } from './pages/SettingsPage';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';
import { ConnectPage } from './pages/ConnectPage';
import { CreateAgentPage } from './pages/CreateAgentPage';
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
        <Route path="/clients" element={<ClientsPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/agents/:name" element={<AgentDetailPage />} />
        <Route path="/agents/new" element={<CreateAgentPage />} />
        <Route path="/escalations" element={<EscalationsPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/connect" element={<ConnectPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  </ErrorBoundary>
);
