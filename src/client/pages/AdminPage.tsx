/** Admin dashboard: health, exercises, flags, members, audit logs. */

import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../i18n';
import { ErrorState, LoadingState } from '../components/ui-states';

type Health = {
  memberCount: number;
  webhookFailures: number;
  syncConflicts7d: number;
  exportStates: Record<string, number>;
  aiFallbacks7d: number;
  overdueCancellations: number;
};

type Member = {
  id: string;
  email: string;
  status: string;
  is_admin: number;
  is_support: number;
  created_at: string;
};

type Flag = { key: string; description: string; enabled: number };

type Exercise = {
  id: string;
  slug: string;
  name_en: string;
  review_status: string;
  version: number;
};

type AuditLog = {
  id: string;
  actor_role: string;
  action: string;
  target_type: string;
  target_id: string | null;
  created_at: string;
};

type Tab = 'health' | 'exercises' | 'flags' | 'members' | 'audit';

export function AdminPage() {
  const { t, formatDate } = useI18n();
  const [tab, setTab] = useState<Tab>('health');
  const [health, setHealth] = useState<Health | null>(null);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [flags, setFlags] = useState<Flag[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [h, ex, fl, me, au] = await Promise.all([
        api<Health>('/admin/health'),
        api<{ exercises: Exercise[] }>('/admin/exercises'),
        api<{ flags: Flag[] }>('/admin/flags'),
        api<{ members: Member[] }>('/admin/members'),
        api<{ logs: AuditLog[] }>('/admin/audit-logs'),
      ]);
      setHealth(h);
      setExercises(ex.exercises);
      setFlags(fl.flags);
      setMembers(me.members);
      setLogs(au.logs);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.permission'));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleFlag(key: string, enabled: boolean) {
    try {
      await api(`/admin/flags/${key}`, { method: 'PUT', body: { enabled } });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.generic'));
    }
  }

  async function setReview(exerciseId: string, action: string) {
    try {
      await api(`/admin/exercises/${exerciseId}/review`, { method: 'POST', body: { action } });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.generic'));
    }
  }

  if (error && !health) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!health) return <LoadingState />;

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'health', label: t('admin.health') },
    { id: 'exercises', label: t('admin.exercises') },
    { id: 'flags', label: t('admin.flags') },
    { id: 'members', label: t('admin.members') },
    { id: 'audit', label: t('admin.audit') },
  ];

  return (
    <div className="space-y-5" data-testid="admin-page">
      <h1 className="text-2xl font-bold text-stone-900">{t('admin.title')}</h1>
      {error && (
        <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <nav aria-label="Admin sections" className="flex flex-wrap gap-2">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            type="button"
            aria-pressed={tab === tb.id}
            onClick={() => setTab(tb.id)}
            className={
              tab === tb.id ? 'btn-primary !min-h-9 text-sm' : 'btn-secondary !min-h-9 text-sm'
            }
          >
            {tb.label}
          </button>
        ))}
      </nav>

      {tab === 'health' && (
        <section
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          aria-label={t('admin.health')}
        >
          <div className="card">
            <p className="text-sm text-stone-500">Active members</p>
            <p className="text-2xl font-bold">{health.memberCount}</p>
          </div>
          <div className="card">
            <p className="text-sm text-stone-500">Failed webhooks</p>
            <p className={`text-2xl font-bold ${health.webhookFailures > 0 ? 'text-red-700' : ''}`}>
              {health.webhookFailures}
            </p>
          </div>
          <div className="card">
            <p className="text-sm text-stone-500">Sync conflicts (7d)</p>
            <p className="text-2xl font-bold">{health.syncConflicts7d}</p>
          </div>
          <div className="card">
            <p className="text-sm text-stone-500">AI fallbacks (7d)</p>
            <p className="text-2xl font-bold">{health.aiFallbacks7d}</p>
          </div>
          <div className="card">
            <p className="text-sm text-stone-500">Overdue cancellations</p>
            <p
              className={`text-2xl font-bold ${health.overdueCancellations > 0 ? 'text-red-700' : ''}`}
            >
              {health.overdueCancellations}
            </p>
          </div>
          <div className="card">
            <p className="text-sm text-stone-500">Report exports</p>
            <p className="text-lg font-bold">
              {Object.entries(health.exportStates)
                .map(([k, v]) => `${k}: ${v}`)
                .join(' · ') || '—'}
            </p>
          </div>
        </section>
      )}

      {tab === 'exercises' && (
        <section aria-label={t('admin.exercises')}>
          <ul className="divide-y divide-stone-100">
            {exercises.map((ex) => (
              <li key={ex.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <p className="font-medium text-stone-900">{ex.name_en}</p>
                  <p className="text-xs text-stone-500">
                    {ex.slug} · v{ex.version}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`badge ${
                      ex.review_status === 'published'
                        ? 'bg-emerald-100 text-emerald-900'
                        : 'bg-stone-100 text-stone-700'
                    }`}
                  >
                    {ex.review_status}
                  </span>
                  {ex.review_status !== 'published' && (
                    <button
                      type="button"
                      className="btn-secondary !min-h-8 !px-2 text-xs"
                      onClick={() => void setReview(ex.id, 'publish')}
                    >
                      Publish
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === 'flags' && (
        <section aria-label={t('admin.flags')}>
          <ul className="space-y-3">
            {flags.map((fl) => (
              <li key={fl.key} className="card flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-stone-900">{fl.key}</p>
                  <p className="text-xs text-stone-500">{fl.description}</p>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <span>{fl.enabled ? 'On' : 'Off'}</span>
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={!!fl.enabled}
                    onChange={(e) => void toggleFlag(fl.key, e.target.checked)}
                    data-testid={`flag-${fl.key}`}
                  />
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === 'members' && (
        <section aria-label={t('admin.members')}>
          <ul className="divide-y divide-stone-100">
            {members.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium text-stone-900">{m.email}</p>
                  <p className="text-xs text-stone-500">
                    joined {formatDate(m.created_at.slice(0, 10))}
                  </p>
                </div>
                <div className="flex gap-1">
                  {m.is_admin ? (
                    <span className="badge bg-brand-100 text-brand-900">admin</span>
                  ) : null}
                  {m.is_support ? (
                    <span className="badge bg-stone-100 text-stone-700">support</span>
                  ) : null}
                  <span className="badge bg-stone-100 text-stone-700">{m.status}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === 'audit' && (
        <section aria-label={t('admin.audit')}>
          <ul className="divide-y divide-stone-100 text-sm">
            {logs.map((log) => (
              <li key={log.id} className="py-2">
                <span className="font-medium">{log.action}</span>{' '}
                <span className="text-stone-500">
                  {log.actor_role} → {log.target_type}
                  {log.target_id ? `/${log.target_id.slice(0, 10)}` : ''} ·{' '}
                  {formatDate(log.created_at.slice(0, 10))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
