/** Resumable multi-step onboarding with per-step validation and progress saving. */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiClientError } from '../lib/api';
import { useI18n } from '../i18n';
import { ErrorState, LoadingState } from '../components/ui-states';

const STEPS = ['basics', 'goals', 'training', 'lifestyle', 'nutrition', 'safety'] as const;
type Step = (typeof STEPS)[number];

export function OnboardingPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('basics');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [, setProgressData] = useState<Record<string, unknown>>({});

  // Shared step data (kept local, saved per step)
  const [sex, setSex] = useState('');
  const [heightCm, setHeightCm] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [goals, setGoals] = useState<string[]>(['fitness']);
  const [targetWeeks, setTargetWeeks] = useState(12);
  const [rangeAck, setRangeAck] = useState(false);
  const [experience, setExperience] = useState('new');
  const [weekdays, setWeekdays] = useState<number[]>([1, 3, 5]);
  const [minutes, setMinutes] = useState(45);
  const [sessions, setSessions] = useState(3);
  const [locations, setLocations] = useState<string[]>(['gym']);
  const [equipment, setEquipment] = useState<string[]>(['free_weights']);
  const [excluded] = useState<string[]>([]);
  const [activity, setActivity] = useState('moderate');
  const [workPattern, setWorkPattern] = useState('desk');
  const [sleep, setSleep] = useState('good');
  const [stress, setStress] = useState('moderate');
  const [eating, setEating] = useState('no_preference');
  const [meals, setMeals] = useState(3);
  const [tracking, setTracking] = useState('coarse');
  const [safetyAck, setSafetyAck] = useState(false);

  const loadProgress = useCallback(async () => {
    try {
      const res = await api<{
        progress: { step: string; data: Record<string, unknown> } | null;
        completed: boolean;
      }>('/onboarding');
      if (res.completed) {
        navigate('/today', { replace: true });
        return;
      }
      if (res.progress?.step) setStep(res.progress.step as Step);
      setProgressData(res.progress?.data ?? {});
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.generic'));
    } finally {
      setLoading(false);
    }
  }, [navigate, t]);

  useEffect(() => {
    void loadProgress();
  }, [loadProgress]);

  async function submitStep(body: unknown) {
    setFieldError(null);
    setError(null);
    try {
      const res = await api<{ nextStep: string; completed: boolean }>(`/onboarding/${step}`, {
        method: 'PUT',
        body,
      });
      if (res.completed) {
        navigate('/today', { replace: true });
      } else {
        setStep(res.nextStep as Step);
      }
    } catch (err) {
      if (err instanceof ApiClientError && err.field) setFieldError(err.message);
      else setError(err instanceof Error ? err.message : t('error.generic'));
    }
  }

  if (loading) return <LoadingState />;
  if (error && !fieldError)
    return <ErrorState message={error} onRetry={() => void loadProgress()} />;

  const stepIndex = STEPS.indexOf(step) + 1;

  function onBasicsSubmit(e: FormEvent) {
    e.preventDefault();
    void submitStep({
      sex: sex || 'prefer_not_to_say',
      heightCm: heightCm ? Number(heightCm) : null,
      weightKg: weightKg ? Number(weightKg) : null,
    });
  }
  function onGoalsSubmit(e: FormEvent) {
    e.preventDefault();
    void submitStep({
      goals: goals.map((goalType, i) => ({ goalType, priority: i + 1 })),
      targetWeeks,
      acknowledgedRange: rangeAck,
    });
  }
  function onTrainingSubmit(e: FormEvent) {
    e.preventDefault();
    void submitStep({
      experienceLevel: experience,
      preferredWeekdays: weekdays,
      minutesPerSession: minutes,
      sessionsPerWeek: sessions,
      locations,
      equipment: equipment.map((category) => ({ category, status: 'available' as const })),
      exclusions: excluded.map((exerciseId) => ({
        exerciseId,
        reasonCode: 'preference' as const,
      })),
      blockedDates: [],
    });
  }
  function onLifestyleSubmit(e: FormEvent) {
    e.preventDefault();
    void submitStep({
      activityLevel: activity,
      workPattern,
      sleepIndicator: sleep,
      stressIndicator: stress,
    });
  }
  function onNutritionSubmit(e: FormEvent) {
    e.preventDefault();
    void submitStep({
      eatingPattern: eating,
      allergies: [],
      avoidIngredients: [],
      budgetLevel: 'moderate',
      cookingTime: 'some',
      mealCount: meals,
      trackingDetail: tracking,
    });
  }
  function onSafetySubmit(e: FormEvent) {
    e.preventDefault();
    void submitStep({
      acknowledgedNoDiagnosis: safetyAck,
      acknowledgedProfessionalHelp: safetyAck,
    });
  }

  return (
    <div className="mx-auto min-h-dvh max-w-lg px-4 py-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
          {t('onboarding.step', { current: stepIndex, total: STEPS.length })}
        </p>
        <h1 className="mt-1 text-2xl font-bold text-stone-900">{t('onboarding.title')}</h1>
        <p className="mt-1 text-sm text-stone-500">{t('onboarding.save_resume')}</p>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-stone-200">
          <div
            className="h-full rounded-full bg-brand-600 transition-all"
            style={{ width: `${(stepIndex / STEPS.length) * 100}%` }}
            role="progressbar"
            aria-valuenow={stepIndex}
            aria-valuemin={1}
            aria-valuemax={STEPS.length}
          />
        </div>
      </header>

      {fieldError && (
        <div role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">
          {fieldError}
        </div>
      )}

      {step === 'basics' && (
        <form onSubmit={onBasicsSubmit} className="card space-y-4" data-testid="onboarding-basics">
          <h2 className="font-semibold text-stone-900">{t('onboarding.basics')}</h2>
          <div>
            <label className="label" htmlFor="ob-sex">
              Sex (used only for energy estimates)
            </label>
            <select
              id="ob-sex"
              className="input"
              value={sex}
              onChange={(e) => setSex(e.target.value)}
            >
              <option value="">Prefer not to say</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="intersex">Intersex</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="ob-height">
                Height (cm)
              </label>
              <input
                id="ob-height"
                type="number"
                className="input"
                value={heightCm}
                onChange={(e) => setHeightCm(e.target.value)}
                min="80"
                max="250"
              />
            </div>
            <div>
              <label className="label" htmlFor="ob-weight">
                Weight (kg)
              </label>
              <input
                id="ob-weight"
                type="number"
                className="input"
                value={weightKg}
                onChange={(e) => setWeightKg(e.target.value)}
                min="25"
                max="400"
              />
            </div>
          </div>
          <p className="hint">We ask for these to estimate energy needs. You can skip both.</p>
          <button type="submit" className="btn-primary w-full">
            {t('action.next')}
          </button>
        </form>
      )}

      {step === 'goals' && (
        <form onSubmit={onGoalsSubmit} className="card space-y-4" data-testid="onboarding-goals">
          <h2 className="font-semibold text-stone-900">{t('onboarding.goals')}</h2>
          <fieldset>
            <legend className="label">Pick up to 3, in priority order</legend>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  'muscle_gain',
                  'fat_loss',
                  'weight_loss',
                  'fitness',
                  'strength',
                  'general_health',
                  'consistent_routine',
                ] as const
              ).map((g) => (
                <label
                  key={g}
                  className="flex items-center gap-2 rounded-xl border border-stone-200 p-3 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={goals.includes(g)}
                    onChange={(e) =>
                      setGoals((prev) =>
                        e.target.checked
                          ? prev.length < 3
                            ? [...prev, g]
                            : prev
                          : prev.filter((x) => x !== g),
                      )
                    }
                  />
                  {t(`onboarding.goal.${g}` as Parameters<typeof t>[0])}
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label className="label" htmlFor="ob-weeks">
              Target timeframe (weeks)
            </label>
            <input
              id="ob-weeks"
              type="range"
              min={8}
              max={24}
              value={targetWeeks}
              className="w-full"
              onChange={(e) => setTargetWeeks(Number(e.target.value))}
            />
            <p className="hint">
              {targetWeeks} weeks — {t('onboarding.realistic_range')}
            </p>
          </div>
          <label className="flex gap-3 text-sm text-stone-700">
            <input
              type="checkbox"
              checked={rangeAck}
              onChange={(e) => setRangeAck(e.target.checked)}
              className="mt-1 h-5 w-5"
            />
            I understand this is a realistic range, not a promise of results.
          </label>
          <button
            type="submit"
            className="btn-primary w-full"
            disabled={goals.length === 0 || !rangeAck}
          >
            {t('action.next')}
          </button>
        </form>
      )}

      {step === 'training' && (
        <form
          onSubmit={onTrainingSubmit}
          className="card space-y-4"
          data-testid="onboarding-training"
        >
          <h2 className="font-semibold text-stone-900">{t('onboarding.training')}</h2>
          <fieldset>
            <legend className="label">Experience level</legend>
            <div className="space-y-2">
              {(['new', 'returning', 'experienced'] as const).map((lvl) => (
                <label
                  key={lvl}
                  className="flex items-center gap-2 rounded-xl border border-stone-200 p-3 text-sm"
                >
                  <input
                    type="radio"
                    name="exp"
                    checked={experience === lvl}
                    onChange={() => setExperience(lvl)}
                  />
                  {t(`onboarding.experience.${lvl}` as Parameters<typeof t>[0])}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="label">Preferred training days</legend>
            <div className="flex flex-wrap gap-2">
              {[0, 1, 2, 3, 4, 5, 6].map((wd) => (
                <button
                  key={wd}
                  type="button"
                  aria-pressed={weekdays.includes(wd)}
                  onClick={() =>
                    setWeekdays((p) => (p.includes(wd) ? p.filter((d) => d !== wd) : [...p, wd]))
                  }
                  className={
                    weekdays.includes(wd)
                      ? 'btn-primary !min-h-9 !px-3'
                      : 'btn-secondary !min-h-9 !px-3'
                  }
                >
                  {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][wd]}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="ob-min">
                Minutes / session
              </label>
              <input
                id="ob-min"
                type="number"
                className="input"
                min={15}
                max={180}
                value={minutes}
                onChange={(e) => setMinutes(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="label" htmlFor="ob-sess">
                Sessions / week
              </label>
              <input
                id="ob-sess"
                type="number"
                className="input"
                min={2}
                max={7}
                value={sessions}
                onChange={(e) => setSessions(Number(e.target.value))}
              />
            </div>
          </div>
          <div>
            <span className="label">Where do you train?</span>
            <div className="flex gap-2">
              {(['home', 'gym', 'outdoors'] as const).map((loc) => (
                <button
                  key={loc}
                  type="button"
                  aria-pressed={locations.includes(loc)}
                  onClick={() =>
                    setLocations((p) =>
                      p.includes(loc)
                        ? p.length > 1
                          ? p.filter((x) => x !== loc)
                          : p
                        : [...p, loc],
                    )
                  }
                  className={
                    locations.includes(loc)
                      ? 'btn-primary !min-h-9 !px-3'
                      : 'btn-secondary !min-h-9 !px-3'
                  }
                >
                  {loc}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="label">Equipment you have</span>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  'free_weights',
                  'barbells',
                  'cables',
                  'machines',
                  'cardio',
                  'bodyweight',
                  'home_equipment',
                ] as const
              ).map((eq) => (
                <label
                  key={eq}
                  className="flex items-center gap-2 rounded-lg border border-stone-200 p-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={equipment.includes(eq)}
                    onChange={(e) =>
                      setEquipment((p) =>
                        e.target.checked ? [...p, eq] : p.filter((x) => x !== eq),
                      )
                    }
                  />
                  {eq.replace('_', ' ')}
                </label>
              ))}
            </div>
          </div>
          <button type="submit" className="btn-primary w-full">
            {t('action.next')}
          </button>
        </form>
      )}

      {step === 'lifestyle' && (
        <form
          onSubmit={onLifestyleSubmit}
          className="card space-y-4"
          data-testid="onboarding-lifestyle"
        >
          <h2 className="font-semibold text-stone-900">{t('onboarding.lifestyle')}</h2>
          <div>
            <label className="label" htmlFor="ob-activity">
              Daily activity level
            </label>
            <select
              id="ob-activity"
              className="input"
              value={activity}
              onChange={(e) => setActivity(e.target.value)}
            >
              <option value="sedentary">Mostly sitting</option>
              <option value="light">Mostly light</option>
              <option value="moderate">Moderate</option>
              <option value="high">Active</option>
              <option value="very_high">Very active</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="ob-work">
              Work pattern
            </label>
            <select
              id="ob-work"
              className="input"
              value={workPattern}
              onChange={(e) => setWorkPattern(e.target.value)}
            >
              <option value="desk">Desk-based</option>
              <option value="mixed">Mixed</option>
              <option value="physical">Physical</option>
              <option value="irregular">Irregular hours</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="ob-sleep">
                Sleep (typical)
              </label>
              <select
                id="ob-sleep"
                className="input"
                value={sleep}
                onChange={(e) => setSleep(e.target.value)}
              >
                <option value="poor">Poor</option>
                <option value="fair">Fair</option>
                <option value="good">Good</option>
                <option value="very_good">Very good</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="ob-stress">
                Stress
              </label>
              <select
                id="ob-stress"
                className="input"
                value={stress}
                onChange={(e) => setStress(e.target.value)}
              >
                <option value="low">Low</option>
                <option value="moderate">Moderate</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>
          <p className="hint">
            These shape plan intensity only — we do not draw medical conclusions.
          </p>
          <button type="submit" className="btn-primary w-full">
            {t('action.next')}
          </button>
        </form>
      )}

      {step === 'nutrition' && (
        <form
          onSubmit={onNutritionSubmit}
          className="card space-y-4"
          data-testid="onboarding-nutrition"
        >
          <h2 className="font-semibold text-stone-900">{t('onboarding.nutrition')}</h2>
          <div>
            <label className="label" htmlFor="ob-eating">
              Eating pattern
            </label>
            <select
              id="ob-eating"
              className="input"
              value={eating}
              onChange={(e) => setEating(e.target.value)}
            >
              <option value="no_preference">No preference</option>
              <option value="vegetarian">Vegetarian</option>
              <option value="vegan">Vegan</option>
              <option value="pescatarian">Pescatarian</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="ob-meals">
                Meals per day
              </label>
              <input
                id="ob-meals"
                type="number"
                min={1}
                max={6}
                className="input"
                value={meals}
                onChange={(e) => setMeals(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="label" htmlFor="ob-tracking">
                Tracking detail
              </label>
              <select
                id="ob-tracking"
                className="input"
                value={tracking}
                onChange={(e) => setTracking(e.target.value)}
              >
                <option value="coarse">Coarse (estimates are fine)</option>
                <option value="moderate">Moderate</option>
                <option value="detailed">Detailed</option>
              </select>
            </div>
          </div>
          <p className="hint">
            Calorie and macro values are always labelled estimates — never medical precision.
          </p>
          <button type="submit" className="btn-primary w-full">
            {t('action.next')}
          </button>
        </form>
      )}

      {step === 'safety' && (
        <form onSubmit={onSafetySubmit} className="card space-y-4" data-testid="onboarding-safety">
          <h2 className="font-semibold text-stone-900">{t('onboarding.safety')}</h2>
          <label className="flex gap-3 rounded-xl border border-stone-200 p-3 text-sm text-stone-800">
            <input
              type="checkbox"
              className="mt-1 h-5 w-5"
              checked={safetyAck}
              onChange={(e) => setSafetyAck(e.target.checked)}
              data-testid="safety-ack"
            />
            <span>
              {t('onboarding.safety_ack')}
              <span className="mt-1 block text-xs text-stone-500">
                {t('onboarding.safety_ack_help')}
              </span>
            </span>
          </label>
          <button type="submit" className="btn-primary w-full" disabled={!safetyAck}>
            {t('action.confirm')}
          </button>
        </form>
      )}
    </div>
  );
}
