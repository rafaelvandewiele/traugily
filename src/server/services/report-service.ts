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

    // Full planned plan queries (need plan.id, so run after destructure).
    let planPhases: { results: Array<{ phase_key: string; title_key: string; purpose: string; start_date: string; end_date: string; position: number }> } | null = null;
    let weeklySchedules: { results: Array<{ weekday: number; kind: string; label_key: string }> } | null = null;
    let scheduledSessions: { results: Array<{ id: string; scheduled_date: string; weekday: number; kind: string; title_key: string; focus_key: string; duration_minutes: number }> } | null = null;
    let sessionExercises: { results: Array<{ id: string; session_id: string; exercise_id: string; position: number; planned_order: number }> } | null = null;
    let plannedSets: { results: Array<{ id: string; session_exercise_id: string; set_index: number; planned_reps: number | null; planned_weight_kg: number | null; rest_seconds: number | null }> } | null = null;
    if (plan) {
      [planPhases, weeklySchedules, scheduledSessions, sessionExercises, plannedSets] =
        await Promise.all([
          db
            .prepare(
              `SELECT phase_key, title_key, purpose, start_date, end_date, position
               FROM plan_phases WHERE version_id = ? ORDER BY position`,
            )
            .bind(plan.id)
            .all<{ phase_key: string; title_key: string; purpose: string; start_date: string; end_date: string; position: number }>(),
          db
            .prepare(`SELECT weekday, kind, label_key FROM weekly_schedules WHERE version_id = ? ORDER BY weekday`)
            .bind(plan.id)
            .all<{ weekday: number; kind: string; label_key: string }>(),
          db
            .prepare(
              `SELECT id, scheduled_date, weekday, kind, title_key, focus_key, duration_minutes
               FROM scheduled_sessions WHERE version_id = ? ORDER BY scheduled_date`,
            )
            .bind(plan.id)
            .all<{ id: string; scheduled_date: string; weekday: number; kind: string; title_key: string; focus_key: string; duration_minutes: number }>(),
          db
            .prepare(`SELECT id, session_id, exercise_id, position, planned_order FROM session_exercises WHERE session_id IN (SELECT id FROM scheduled_sessions WHERE version_id = ?) ORDER BY session_id, position`)
            .bind(plan.id)
            .all<{ id: string; session_id: string; exercise_id: string; position: number; planned_order: number }>(),
          db
            .prepare(`SELECT id, session_exercise_id, set_index, planned_reps, planned_weight_kg, rest_seconds FROM planned_sets WHERE session_exercise_id IN (SELECT id FROM session_exercises WHERE session_id IN (SELECT id FROM scheduled_sessions WHERE version_id = ?)) ORDER BY session_exercise_id, set_index`)
            .bind(plan.id)
            .all<{ id: string; session_exercise_id: string; set_index: number; planned_reps: number | null; planned_weight_kg: number | null; rest_seconds: number | null }>(),
        ]);
    }

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

    // §12 full planned plan (standard/detailed): per week, per session,
    // per exercise with sets/reps/weight — the whole training plan visible any time.
    if (plan && input.detailLevel !== 'summary' && planPhases && weeklySchedules &&
        scheduledSessions && sessionExercises && plannedSets) {
      const exercisesBySession = new Map<string, typeof sessionExercises.results[0][]>();
      for (const se of sessionExercises.results) {
        const arr = exercisesBySession.get(se.session_id) ?? [];
        arr.push(se);
        exercisesBySession.set(se.session_id, arr);
      }
      const setsByExercise = new Map<string, typeof plannedSets.results[0][]>();
      for (const ps of plannedSets.results) {
        const arr = setsByExercise.get(ps.session_exercise_id) ?? [];
        arr.push(ps);
        setsByExercise.set(ps.session_exercise_id, arr);
      }
      const weeklyPlan: Array<{ week: number; sessions: Array<{ date: string; title: string; exercises: Array<{ name: string; sets: string }> }> }> = [];
      for (const phase of planPhases.results) {
        const phaseSessions = scheduledSessions.results.filter((s) => {
          const d = new Date(s.scheduled_date);
          const ps = new Date(phase.start_date);
          const pe = new Date(phase.end_date);
          return d >= ps && d <= pe;
        });
        if (phaseSessions.length === 0) continue;
        const weekEntries = phaseSessions.map((s) => {
          const exs = exercisesBySession.get(s.id) ?? [];
          return {
            date: s.scheduled_date,
            title: s.title_key,
            exercises: exs.map((ex) => {
              const ps = setsByExercise.get(ex.id) ?? [];
              return {
                name: ex.exercise_id,
                sets: ps.map((x) => `${x.planned_reps ?? '?'} × ${x.planned_weight_kg ?? '?'}kg`).join(', '),
              };
            }),
          };
        });
        weeklyPlan.push({
          week: phase.position,
          sessions: weekEntries,
        });
      }

      const planItems: string[] = [];
      for (const w of weeklyPlan) {
        planItems.push(`Week ${w.week}:`);
        for (const sess of w.sessions) {
          planItems.push(`  ${sess.date} — ${sess.title}`);
          for (const ex of sess.exercises) {
            planItems.push(`    • ${ex.name}: ${ex.sets}`);
          }
        }
      }
      sections.push({
        kind: 'heading',
        text: 'Full training plan (per week)',
      });
      sections.push({
        kind: 'bullets',
        items: planItems.length > 0 ? planItems : ['No sessions planned.'],
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
