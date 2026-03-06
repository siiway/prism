// Main router

import { BrowserRouter, Navigate, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ThemeProvider } from './components/ThemeProvider';
import { Layout } from './components/Layout';
import { useAuthStore } from './store/auth';
import { api } from './lib/api';

// Pages
import { Init } from './pages/Init';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Dashboard } from './pages/Dashboard';
import { Profile } from './pages/Profile';
import { Security } from './pages/Security';
import { AppList } from './pages/apps/AppList';
import { AppDetail } from './pages/apps/AppDetail';
import { Domains } from './pages/Domains';
import { Connections } from './pages/Connections';
import { Authorize } from './pages/oauth/Authorize';
import { AdminLayout } from './pages/admin/AdminLayout';
import { AdminDashboard } from './pages/admin/AdminDashboard';
import { AdminUsers } from './pages/admin/AdminUsers';
import { AdminApps } from './pages/admin/AdminApps';
import { AdminSettings } from './pages/admin/AdminSettings';
import { AdminAudit } from './pages/admin/AdminAudit';

const qc = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

// Auth guard
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { token } = useAuthStore();
  const navigate = useNavigate();
  useEffect(() => {
    if (!token) navigate(`/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`, { replace: true });
  }, [token, navigate]);
  if (!token) return null;
  return <>{children}</>;
}

// Admin guard
function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  if (user?.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

// Social auth callback handler: /auth/callback?token=...
function AuthCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();

  useEffect(() => {
    const token = params.get('token');
    if (!token) { navigate('/login?error=no_token'); return; }

    api.me().then(({ user }) => {
      setAuth(token, user);
      navigate('/');
    }).catch(() => navigate('/login?error=invalid_token'));
  }, []);

  return null;
}

// Init guard: redirect to /init if not initialized
function InitGuard({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  useEffect(() => {
    api.initStatus().then(({ initialized }) => {
      if (!initialized) navigate('/init', { replace: true });
    });
  }, [navigate]);
  return <>{children}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <ThemeProvider>
        <BrowserRouter>
          <Routes>
            {/* Public */}
            <Route path="/init" element={<Init />} />
            <Route path="/login" element={<InitGuard><Login /></InitGuard>} />
            <Route path="/register" element={<InitGuard><Register /></InitGuard>} />
            <Route path="/auth/callback" element={<AuthCallback />} />

            {/* OAuth consent */}
            <Route path="/oauth/authorize" element={<Authorize />} />

            {/* Protected app shell */}
            <Route element={<RequireAuth><InitGuard><Layout /></InitGuard></RequireAuth>}>
              <Route index element={<Dashboard />} />
              <Route path="profile" element={<Profile />} />
              <Route path="security" element={<Security />} />
              <Route path="apps" element={<AppList />} />
              <Route path="apps/:id" element={<AppDetail />} />
              <Route path="domains" element={<Domains />} />
              <Route path="connections" element={<Connections />} />

              {/* Admin */}
              <Route path="admin" element={<RequireAdmin><AdminLayout /></RequireAdmin>}>
                <Route index element={<AdminDashboard />} />
                <Route path="users" element={<AdminUsers />} />
                <Route path="apps" element={<AdminApps />} />
                <Route path="settings" element={<AdminSettings />} />
                <Route path="audit" element={<AdminAudit />} />
              </Route>
            </Route>

            {/* Catch-all */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
