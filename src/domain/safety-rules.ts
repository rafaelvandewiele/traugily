/**
 * Safety rules: conservative, configurable, reviewed-product defaults.
 * TODO(clinical/legal): the keyword sets and thresholds below are product defaults,
 * NOT medically validated. A qualified professional must review before public launch.
 * These rules never diagnose — they only decide which safe guidance to show and
 * whether an AI recommendation is blocked.
 */

export type SafetyRule = {
  id: string;
  ruleCode: string;
  severity: 'advisory' | 'block' | 'urgent';
  guidanceKey: string;
  blockAi: boolean;
  requiresFollowUp: boolean;
  condition:
    | { kind: 'urgent_keywords'; keywords: string[] }
    | { kind: 'severity_in'; severities: string[] }
    | { kind: 'recurrence'; reportsSameAreaInDays: number; minimumReports: number };
};

export const DEFAULT_SAFETY_RULES: SafetyRule[] = [
  {
    id: 'sr_urgent_signals',
    ruleCode: 'urgent_signals',
    severity: 'urgent',
    guidanceKey: 'safety.guidance.urgent',
    blockAi: true,
    requiresFollowUp: true,
    condition: {
      kind: 'urgent_keywords',
      keywords: [
        'chest pain',
        'faint',
        'fainting',
        'dizziness',
        'shortness of breath',
        'numbness',
        'cannot stand',
      ],
    },
  },
  {
    id: 'sr_pain_reported',
    ruleCode: 'pain_reported',
    severity: 'block',
    guidanceKey: 'safety.guidance.pain',
    blockAi: true,
    requiresFollowUp: true,
    condition: { kind: 'severity_in', severities: ['pain'] },
  },
  {
    id: 'sr_discomfort_reported',
    ruleCode: 'discomfort_reported',
    severity: 'advisory',
    guidanceKey: 'safety.guidance.discomfort',
    blockAi: false,
    requiresFollowUp: false,
    condition: { kind: 'severity_in', severities: ['discomfort'] },
  },
  {
    id: 'sr_recurrence_block',
    ruleCode: 'recurrence_block',
    severity: 'block',
    guidanceKey: 'safety.guidance.recurrence',
    blockAi: true,
    requiresFollowUp: true,
    condition: { kind: 'recurrence', reportsSameAreaInDays: 14, minimumReports: 2 },
  },
];

export type SafetyEvaluation = {
  matchedRuleId: string | null;
  matchedRuleCode: string | null;
  severity: 'none' | 'advisory' | 'block' | 'urgent';
  guidanceKey: string | null;
  blockAi: boolean;
  requiresFollowUp: boolean;
  stopTraining: boolean;
};

const NO_MATCH: SafetyEvaluation = {
  matchedRuleId: null,
  matchedRuleCode: null,
  severity: 'none',
  guidanceKey: null,
  blockAi: false,
  requiresFollowUp: false,
  stopTraining: false,
};

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Evaluate a member's pain/discomfort report against the active rule set.
 * Urgent signals always win: stop training, seek suitable help, no alternative
 * exercise is forced and no medical interpretation is given.
 */
export function evaluateSafetyReport(input: {
  severity: 'discomfort' | 'pain' | 'urgent';
  note?: string;
  bodyArea?: string;
  rules?: SafetyRule[];
  recentReports?: Array<{ severity: string; bodyArea: string; reportedAt: string }>;
  now?: Date;
}): SafetyEvaluation {
  const rules = input.rules ?? DEFAULT_SAFETY_RULES;
  const note = normalize(input.note ?? '');
  const now = input.now ?? new Date();

  const build = (
    rule: SafetyRule,
    severity: SafetyEvaluation['severity'],
    stopTraining: boolean,
  ): SafetyEvaluation => ({
    matchedRuleId: rule.id,
    matchedRuleCode: rule.ruleCode,
    severity,
    guidanceKey: rule.guidanceKey,
    blockAi: rule.blockAi,
    requiresFollowUp: rule.requiresFollowUp,
    stopTraining,
  });

  // 1. Urgent signals always win — checked first across all rules.
  for (const rule of rules) {
    if (rule.condition.kind === 'urgent_keywords' && note.length > 0) {
      if (rule.condition.keywords.some((k) => note.includes(k))) return build(rule, 'urgent', true);
    }
  }

  // 2. Recurrence escalates to a block BEFORE generic severity rules, so repeated
  //    reports in the same area outrank a fresh "discomfort".
  for (const rule of rules) {
    if (rule.condition.kind !== 'recurrence') continue;
    const recurrence = rule.condition;
    const area = normalize(input.bodyArea ?? 'unspecified');
    const inWindow = (input.recentReports ?? []).filter((r) => {
      const ageDays = (now.getTime() - Date.parse(r.reportedAt)) / 86_400_000;
      return (
        normalize(r.bodyArea) === area &&
        ageDays >= 0 &&
        ageDays <= recurrence.reportsSameAreaInDays
      );
    });
    if (inWindow.length + 1 >= recurrence.minimumReports) return build(rule, 'block', false);
  }

  // 3. Severity-based rules.
  for (const rule of rules) {
    if (
      rule.condition.kind === 'severity_in' &&
      rule.condition.severities.includes(input.severity)
    ) {
      return build(rule, rule.severity, rule.severity !== 'advisory');
    }
  }

  return NO_MATCH;
}
/**
 * Determine whether an AI recommendation must be blocked. Records the blocking rule
 * id without exposing sensitive member text.
 */
export function blockAiRecommendation(evaluation: SafetyEvaluation): {
  blocked: boolean;
  ruleId: string | null;
  ruleCode: string | null;
} {
  return {
    blocked: evaluation.blockAi,
    ruleId: evaluation.matchedRuleId,
    ruleCode: evaluation.matchedRuleCode,
  };
}

/**
 * A reported exercise must not be increased until the member makes a safe follow-up
 * selection. Returns true when progression for that exercise is currently allowed.
 */
export function isProgressionAllowed(exerciseId: string, blockedExerciseIds: string[]): boolean {
  return !blockedExerciseIds.includes(exerciseId);
}
