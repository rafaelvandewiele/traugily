/** App shell: providers + React Router routes. */

import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { I18nProvider } from './i18n';
import { SessionProvider, useSession } from './hooks/useSession';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';
import { ForgotPasswordPage, ResetPasswordPage, VerifyEmailPage } from './pages/AuthPages';
import { OnboardingPage } from './pages/OnboardingPage';
import { TodayPage } from './pages/TodayPage';
import { PlanPage } from './pages/PlanPage';
import { LogPage } from './pages/LogPage';
import { WorkoutPlayerPage } from './pages/WorkoutPlayerPage';
import { ProgressPage } from './pages/ProgressPage';
import { ReportsPage } from './pages/ReportsPage';
import { CalendarPage } from './pages/CalendarPage';
import { AccountPage } from './pages/AccountPage';
import { AdminPage } from './pages/AdminPage';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useSession();
  const location = useLocation();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status">
        <span className="text-stone-500">Loading…</span>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useSession();
  if (loading)
    return (
      <div role="status" className="p-8 text-center text-stone-500">
        Loading…
      </div>
    );
  if (!user?.isAdmin) {
    return (
      <div className="p-8 text-center">
        <p className="font-semibold text-stone-800">You do not have access to this area.</p>
      </div>
    );
  }
  return <>{children}</>;
}

function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { user, loading } = useSession();
  if (loading)
    return (
      <div role="status" className="p-8 text-center text-stone-500">
        Loading…
      </div>
    );
  if (user) return <Navigate to="/today" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <I18nProvider>
      <SessionProvider>
        <BrowserRouter>
          <Routes>
            <Route
              path="/login"
              element={
                <RedirectIfAuthed>
                  <LoginPage />
                </RedirectIfAuthed>
              }
            />
            <Route
              path="/signup"
              element={
                <RedirectIfAuthed>
                  <SignupPage />
                </RedirectIfAuthed>
              }
            />
            <Route path="/verify-email" element={<VerifyEmailPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route
              path="/onboarding"
              element={
                <RequireAuth>
                  <OnboardingPage />
                </RequireAuth>
              }
            />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <AppShell />
                </RequireAuth>
              }
            >
              <Route index element={<Navigate to="/today" replace />} />
              <Route path="today" element={<TodayPage />} />
              <Route path="plan" element={<PlanPage />} />
              <Route path="log" element={<LogPage />} />
              <Route path="workout/:workoutId" element={<WorkoutPlayerPage />} />
              <Route path="progress" element={<ProgressPage />} />
              <Route path="reports" element={<ReportsPage />} />
              <Route path="calendar" element={<CalendarPage />} />
              <Route path="account" element={<AccountPage />} />
              <Route
                path="admin"
                element={
                  <RequireAdmin>
                    <AdminPage />
                  </RequireAdmin>
                }
              />
            </Route>
            <Route path="*" element={<Navigate to="/today" replace />} />
          </Routes>
        </BrowserRouter>
      </SessionProvider>
    </I18nProvider>
  );
}
