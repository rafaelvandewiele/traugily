/** Report PDF assembly: gather member data, build labelled sections, store in private R2. */

import type { Env } from '../env';
import { buildReportPdf, type ReportSection } from './pdf';
import { newId, nowIso } from '../lib/ids';
import { formatDateForLocale } from '../../shared/units';
import { reportHeadings } from '../lib/report-strings';

export async function generateReportPdf(
  env: Env,
  exportId: string,
  userId: string,
  input: {
    periodStart: string;
    periodEnd: string;
    detailLevel: 'summary' | 'standard' | 'detailed';
    reportLocale: string;
  },
): Promise<void> {
  const db = env.DB;
  await db
    .prepare(
      `UPDATE report_exports SET status = 'processing', attempts = attempts + 1 WHERE id = ?`,
    )
    .bind(exportId)
    .run();

  try {
    const [user, profile, plan, goals, weighIns, setLogs, adaptations, painReports, targets] =
      await Promise.all([
        db
          .prepare(`SELECT timezone FROM users WHERE id = ?`)
          .bind(userId)
          .first<{ timezone: string }>(),
        db
          .prepare(`SELECT activity_level, weight_kg FROM profiles WHERE user_id = ?`)
          .bind(userId)
          .first<{ activity_level: string; weight_kg: number | null }>(),
        db
          .prepare(
            `SELECT p.id, p.goal_duration_weeks, pv.version FROM plans p
             JOIN plan_versions pv ON pv.id = p.current_version_id
             WHERE p.user_id = ? AND p.status = 'active' LIMIT 1`,
          )
          .bind(userId)
          .first<{ id: string; goal_duration_weeks: number; version: number }>(),
        db
          .prepare(`SELECT goal_type FROM goals WHERE user_id = ? ORDER BY priority`)
          .bind(userId)
          .all<{ goal_type: string }>(),
        db
          .prepare(
            `SELECT entry_date, weight_kg, skipped FROM weigh_ins
             WHERE user_id = ? AND entry_date BETWEEN ? AND ? ORDER BY entry_date`,
          )
          .bind(userId, input.periodStart, input.periodEnd)
          .all<{ entry_date: string; weight_kg: number; skipped: number }>(),
        db
          .prepare(
            `SELECT sl.set_index, sl.actual_weight_kg, sl.actual_reps, sl.status,
                    ps.planned_reps, ps.planned_weight_kg, e.name_en, w.started_at
             FROM set_logs sl
             JOIN performed_exercises pe ON pe.id = sl.performed_exercise_id
             JOIN exercises e ON e.id = pe.exercise_id
             JOIN workout_executions w ON w.id = sl.workout_id
             LEFT JOIN planned_sets ps ON ps.id = sl.planned_set_id
             WHERE w.user_id = ? AND substr(w.started_at, 1, 10) BETWEEN ? AND ?
             ORDER BY w.started_at, pe.actual_position, sl.set_index`,
          )
          .bind(userId, input.periodStart, input.periodEnd)
          .all<{
            set_index: number;
            actual_weight_kg: number | null;
            actual_reps: number | null;
            status: string;
            planned_reps: number | null;
            planned_weight_kg: number | null;
            name_en: string;
            started_at: string;
          }>(),
        db
          .prepare(
            `SELECT trigger_code, status, effective_date FROM adaptation_proposals
             WHERE user_id = ? AND substr(created_at, 1, 10) BETWEEN ? AND ? ORDER BY created_at`,
          )
          .bind(userId, input.periodStart, input.periodEnd)
          .all<{ trigger_code: string; status: string; effective_date: string }>(),
        db
          .prepare(
            `SELECT severity, body_area, reported_at FROM pain_reports
             WHERE user_id = ? AND substr(reported_at, 1, 10) BETWEEN ? AND ? ORDER BY reported_at`,
          )
          .bind(userId, input.periodStart, input.periodEnd)
          .all<{ severity: string; body_area: string; reported_at: string }>(),
        db
          .prepare(
            `SELECT nt.energy_kcal, nt.protein_g, nt.carbs_g, nt.fat_g, nt.basis, nt.phase_key
             FROM nutrition_targets nt JOIN plans p ON p.id = nt.plan_id
             WHERE p.user_id = ? ORDER BY nt.effective_from DESC LIMIT 4`,
          )
          .bind(userId)
          .all<{
            energy_kcal: number;
            protein_g: number;
            carbs_g: number;
            fat_g: number;
            basis: string;
            phase_key: string | null;
          }>(),
      ]);

    const h = reportHeadings(input.reportLocale);
    const locale = input.reportLocale;
    const tz = user?.timezone ?? 'UTC';
    const sections: ReportSection[] = [];

    sections.push({ kind: 'heading', text: h.profileGoals });
    sections.push({
      kind: 'bullets',
      items: [
        `${h.goals}: ${goals.results.map((g) => g.goal_type).join(', ') || '—'}`,
        `${h.planDuration}: ${plan?.goal_duration_weeks ?? '—'} weeks (v${plan?.version ?? '—'})`,
        `${h.activity}: ${profile?.activity_level ?? '—'}`,
        `${h.storedWeight}: ${profile?.weight_kg ?? '—'} kg`,
      ],
    });

    const weights = weighIns.results.filter((w) => !w.skipped);
    const trendItems: string[] = [];
    for (let i = 0; i < weights.length; i++) {
      const slice = weights.slice(Math.max(0, i - 2), i + 1);
      const avg = Math.round((slice.reduce((a, b) => a + b.weight_kg, 0) / slice.length) * 10) / 10;
      trendItems.push(
        `${formatDateForLocale(weights[i].entry_date, locale)}: ${weights[i].weight_kg} kg (avg3 ${avg})`,
      );
    }
    sections.push({ kind: 'heading', text: h.weightTrend });
    sections.push({ kind: 'bullets', items: trendItems.length > 0 ? trendItems : [h.noWeighIns] });
    sections.push({ kind: 'paragraph', text: h.estimateNotice });

    const completedSets = setLogs.results.filter((r) => r.status === 'completed').length;
    const sessionDates = new Set(setLogs.results.map((r) => String(r.started_at).slice(0, 10)));

    // §12 training (planned vs actual): summary gets an aggregate paragraph so the
    // section is never silently dropped; standard/detailed get the full per-set table.
    sections.push({ kind: 'heading', text: h.sessions });
    if (input.detailLevel === 'summary') {
      sections.push({
        kind: 'paragraph',
        text: `${sessionDates.size} ${h.sessionsSummary} · ${completedSets} ${h.completedSets}`,
      });
    } else if (setLogs.results.length === 0) {
      sections.push({ kind: 'bullets', items: [h.noSessions] });
    } else {
      sections.push({
        kind: 'table',
        table: {
          title: 'sets',
          columns: h.tableColumns,
          columnWidths: [0.12, 0.2, 0.06, 0.11, 0.11, 0.12, 0.11, 0.17],
          rows: setLogs.results.map((r) => ({
            cells: [
              formatDateForLocale(String(r.started_at).slice(0, 10), locale),
              r.name_en,
              String(r.set_index),
              r.planned_weight_kg != null ? `${r.planned_weight_kg} kg` : '—',
              r.planned_reps != null ? `${r.planned_reps}` : '—',
              r.actual_weight_kg != null ? `${r.actual_weight_kg} kg` : '—',
              r.actual_reps != null ? `${r.actual_reps}` : '—',
              r.status,
            ],
          })),
        },
      });
    }

    // §12 adaptations: heading always present at standard/detailed (empty-state
    // keeps section order stable); full per-proposal list at detailed.
    if (input.detailLevel !== 'summary') {
      sections.push({ kind: 'heading', text: h.adaptations });
      sections.push({
        kind: 'bullets',
        items:
          adaptations.results.length > 0
            ? adaptations.results.map(
                (a) => `${a.trigger_code} → ${a.status} (effective ${a.effective_date})`,
              )
            : [h.noAdaptations],
      });
    }

    // §12 nutrition: always rendered; estimates explicitly labelled (AC R 01).
    sections.push({ kind: 'heading', text: h.nutrition });
    sections.push({
      kind: 'bullets',
      items:
        targets.results.length > 0
          ? targets.results.map(
              (t) =>
                `${t.phase_key ?? 'current'}: ${t.energy_kcal} kcal, P ${t.protein_g}g, C ${t.carbs_g}g, F ${t.fat_g}g (${t.basis})`,
            )
          : [h.noNutrition],
    });

    // §12 safety: always rendered; empty-state confirms app-guidance posture.
    sections.push({ kind: 'heading', text: h.safety });
    sections.push({
      kind: 'bullets',
      items:
        painReports.results.length > 0
          ? painReports.results.map(
              (p) =>
                `${formatDateForLocale(String(p.reported_at).slice(0, 10), locale)}: ${p.severity} (${p.body_area}) → ${h.appGuidanceApplied}`,
            )
          : [h.noSafety],
    });

    const pdf = await buildReportPdf({
      title: h.title,
      subtitle: `${formatDateForLocale(input.periodStart, locale)} – ${formatDateForLocale(input.periodEnd, locale)} · ${input.detailLevel}`,
      meta: [
        { label: h.reportLanguage, value: locale.toUpperCase() },
        {
          label: h.period,
          value: `${formatDateForLocale(input.periodStart, locale)} – ${formatDateForLocale(input.periodEnd, locale)}`,
        },
        { label: h.detailLevel, value: input.detailLevel },
        { label: h.timezone, value: tz },
        { label: h.planVersion, value: plan ? `v${plan.version}` : '—' },
        { label: h.generated, value: nowIso() },
        { label: h.notices, value: h.estimateNotice },
      ],
      sections,
    });

    const objectKey = `reports/${userId}/${exportId}.pdf`;
    await env.MEDIA.put(objectKey, pdf, { httpMetadata: { contentType: 'application/pdf' } });
    await db
      .prepare(
        `INSERT INTO r2_objects (object_key, owner_user_id, purpose, content_type, size_bytes, created_at)
         VALUES (?, ?, 'report_pdf', 'application/pdf', ?, ?)`,
      )
      .bind(objectKey, userId, pdf.byteLength, nowIso())
      .run();

    await db
      .prepare(
        `UPDATE report_exports SET status = 'ready', object_key = ?, file_size = ?,
           completed_at = ?, error_message = NULL WHERE id = ?`,
      )
      .bind(objectKey, pdf.byteLength, nowIso(), exportId)
      .run();

    await db
      .prepare(
        `INSERT INTO notifications (id, user_id, kind, title_key, body_key, params, created_at)
         VALUES (?, ?, 'report_ready', 'notification.report_ready.title',
                 'notification.report_ready.body', ?, ?)`,
      )
      .bind(newId('ntf'), userId, JSON.stringify({ exportId }), nowIso())
      .run();
  } catch (err) {
    await db
      .prepare(`UPDATE report_exports SET status = 'failed', error_message = ? WHERE id = ?`)
      .bind(err instanceof Error ? err.message.slice(0, 200) : 'generation_failed', exportId)
      .run();
    throw err;
  }
}
