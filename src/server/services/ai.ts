/**
 * Provider-agnostic AI layer. All outputs are constrained by validated catalogue
 * entries and deterministic rules — AI may only draft explanations or select from
 * allowed options, never invent exercises, loads, or protocols. Keys stay server-side.
 * On provider failure we fall back to deterministic templates and record an
 * operational event; safe data access and logging are never blocked.
 */

import { recordOperationalEvent } from '../lib/audit';

export type AiProvider = 'template' | 'openai' | string;

export type AiExplanationRequest = {
  purpose: 'plan_explanation' | 'adaptation_explanation';
  locale: string;
  promptVersion: string;
  /** Allowed vocabulary — the provider must not reference anything outside this set. */
  allowedExerciseIds: string[];
  signalSummary: Record<string, number | string>;
  fallbackExplanation: string;
};

export type AiExplanationResult = {
  text: string;
  source: 'ai' | 'fallback';
  blockedByRule?: string | null;
};

type AiEnv = {
  AI_PROVIDER?: AiProvider;
  AI_API_KEY?: string;
  AI_API_BASE_URL?: string;
  DB: D1Database;
};

export async function explainWithAi(
  env: AiEnv,
  request: AiExplanationRequest,
  requestId?: string,
): Promise<AiExplanationResult> {
  const provider = env.AI_PROVIDER ?? 'template';

  // Safety gate: a blocking rule short-circuits AI entirely (deterministic guidance only).
  if (request.signalSummary.blockedByRule) {
    return {
      text: request.fallbackExplanation,
      source: 'fallback',
      blockedByRule: String(request.signalSummary.blockedByRule),
    };
  }

  if (provider !== 'openai' || !env.AI_API_KEY) {
    return { text: request.fallbackExplanation, source: 'fallback' };
  }

  try {
    const baseUrl = env.AI_API_BASE_URL ?? 'https://api.openai.com/v1';
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.AI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        max_tokens: 300,
        messages: [
          {
            role: 'system',
            content:
              'You explain fitness plans in plain, supportive language. You never invent exercises, loads, medical advice, or guaranteed outcomes. You may only reference the allowed exercise ids supplied by the user. If unsure, say so briefly.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              purpose: request.purpose,
              locale: request.locale,
              allowedExerciseIds: request.allowedExerciseIds,
              signals: request.signalSummary,
            }),
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`ai_http_${res.status}`);
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    let text = json.choices?.[0]?.message?.content?.trim() ?? '';
    // Constrain output: strip any mention of exercise ids outside the allowed set.
    const mentioned = text.match(/\b(ex_[a-z0-9_]+)\b/g) ?? [];
    for (const id of mentioned) {
      if (!request.allowedExerciseIds.includes(id)) {
        text = text.replace(new RegExp(id, 'g'), 'the planned exercise');
      }
    }
    if (!text) throw new Error('ai_empty_response');
    return { text: text.slice(0, 1200), source: 'ai', blockedByRule: null };
  } catch (err) {
    await recordOperationalEvent(env.DB, {
      kind: 'ai_fallback',
      severity: 'warning',
      subject: request.purpose,
      detail: { message: err instanceof Error ? err.message.slice(0, 120) : 'unknown' },
      requestId,
    }).catch(() => undefined);
    return { text: request.fallbackExplanation, source: 'fallback' };
  }
}
