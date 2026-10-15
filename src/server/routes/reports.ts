/** Reports: create export record (idempotent), list status, download from private R2. */

import { Hono } from 'hono';
import type { Env, AppVariables } from '../env';
import { reportRequestSchema } from '../../shared/contracts';
import { badRequest, notFound, tooManyRequests, unauthorized } from '../lib/errors';
import { newId, nowIso } from '../lib/ids';
import { getAuth } from '../middleware/auth';
import { checkRateLimit, RATE_LIMITS } from '../lib/rate-limit';
import { generateReportPdf } from '../services/report-service';
import { writeAudit } from '../lib/audit';

export const reportRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

reportRoutes.post('/', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const flag = await c.env.DB.prepare(
    `SELECT enabled FROM feature_flags WHERE key = 'pdf_reports'`,
  ).first<{ enabled: number }>();
  if (!flag?.enabled) {
    return c.json(
      { error: { code: 'feature_disabled', message: 'PDF reports are temporarily unavailable.' } },
      503,
    );
  }
  const rl = await checkRateLimit(
    c.env.CACHE,
    'report_create',
    auth.user.id,
    RATE_LIMITS.reportCreate.limit,
    RATE_LIMITS.reportCreate.windowMs,
  );
  if (!rl.allowed)
    throw tooManyRequests('You have requested several reports recently. Please wait a little.');

  const body = await c.req.json().catch(() => null);
  const parsed = reportRequestSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw badRequest(issue?.message ?? 'Invalid report request.', issue?.path.join('.'));
  }
  const d = parsed.data;

  // Idempotency: identical report requests reuse the existing export record.
  const existing = await c.env.DB.prepare(
    `SELECT id, status, created_at FROM report_exports
     WHERE user_id = ? AND period_start = ? AND period_end = ? AND detail_level = ? AND report_locale = ?`,
  )
    .bind(auth.user.id, d.periodStart, d.periodEnd, d.detailLevel, d.reportLocale)
    .first<{ id: string; status: string; created_at: string }>();
  if (existing && existing.status !== 'failed') {
    return c.json({ exportId: existing.id, status: existing.status, deduplicated: true });
  }

  const exportId = existing?.id ?? newId('rpt');
  const now = nowIso();
  if (existing) {
    await c.env.DB.prepare(
      `UPDATE report_exports SET status = 'pending', attempts = attempts + 1, error_message = NULL,
         completed_at = NULL WHERE id = ?`,
    )
      .bind(exportId)
      .run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO report_exports (id, user_id, period_start, period_end, detail_level, report_locale,
         status, attempts, timezone, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, 'UTC', ?)`,
    )
      .bind(exportId, auth.user.id, d.periodStart, d.periodEnd, d.detailLevel, d.reportLocale, now)
      .run();
  }

  // Generation runs in the background via waitUntil; status is polled by the UI.
  // A cron job retries any record stuck in pending/failed — no fake queue claims.
  c.executionCtx.waitUntil(
    generateReportPdf(c.env, exportId, auth.user.id, d).catch((err) => {
      console.error(
        '[report] generation failed',
        exportId,
        err instanceof Error ? err.message : err,
      );
    }),
  );

  return c.json({ exportId, status: 'pending' }, 202);
});

reportRoutes.get('/', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const rows = await c.env.DB.prepare(
    `SELECT id, period_start, period_end, detail_level, report_locale, status, file_size,
            error_message, attempts, created_at, completed_at
     FROM report_exports WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`,
  )
    .bind(auth.user.id)
    .all();
  return c.json({ exports: rows.results });
});

reportRoutes.get('/:id/status', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const row = await c.env.DB.prepare(
    `SELECT id, status, file_size, error_message, attempts, completed_at
     FROM report_exports WHERE id = ? AND user_id = ?`,
  )
    .bind(c.req.param('id'), auth.user.id)
    .first<{
      id: string;
      status: string;
      file_size: number | null;
      error_message: string | null;
      attempts: number;
      completed_at: string | null;
    }>();
  if (!row) throw notFound('Report not found.');
  return c.json(row);
});

reportRoutes.get('/:id/download', async (c) => {
  const auth = getAuth(c.env, c);
  if (!auth) throw unauthorized();
  const row = await c.env.DB.prepare(
    `SELECT id, object_key, status, report_locale, period_start, period_end
     FROM report_exports WHERE id = ? AND user_id = ?`,
  )
    .bind(c.req.param('id'), auth.user.id)
    .first<{
      id: string;
      object_key: string | null;
      status: string;
      report_locale: string;
      period_start: string;
      period_end: string;
    }>();
  if (!row) throw notFound('Report not found.');
  if (row.status !== 'ready' || !row.object_key) {
    throw badRequest('This report is not ready yet. Please check its status and try again.');
  }
  const object = await c.env.MEDIA.get(row.object_key);
  if (!object) throw notFound('Report file is no longer available. Generate a new report.');
  await writeAudit(c.env.DB, {
    actor: { userId: auth.user.id, role: 'member' },
    action: 'report_downloaded',
    targetType: 'report_export',
    targetId: row.id,
  });
  return new Response(object.body, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="traugily-report-${row.period_start}-to-${row.period_end}.pdf"`,
      'cache-control': 'private, no-store',
    },
  });
});
