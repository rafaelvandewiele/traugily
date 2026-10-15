# Traugily

Traugily is a consumer fitness and nutrition coaching web app: personalised
training plans, safe and explainable adaptations, flexible nutrition guidance,
offline-capable workout logging, progress insights and PDF reports — delivered
as an installable PWA on **Cloudflare Workers** (one deployment for the API,
static assets, Stripe webhooks and cron jobs).

> Traugily is not a medical product. It never diagnoses, treats, or
> guarantees outcomes. Safety thresholds are conservative, configurable
> defaults that require qualified professional/legal review before production
> launch (search this repo for `TODO(safety)` / `TODO(legal)`).

## Local quick start

Requirements: **Node ≥ 22**, npm.

```bash
npm install
cp .dev.vars.example .dev.vars      # local secrets; placeholders are fine for dev
npm run db:migrate                  # apply D1 migrations locally
npm run db:seed                     # approved demo catalogue + translations
npm run admin:create                # optional: bootstrap the first admin account
npm run dev                         # http://localhost:5173
```

Useful extras:

```bash
npm run db:reset:local              # wipe the local D1 state
npm run icons                       # regenerate PWA icons into public/icons
npm run test:e2e:install            # download the Playwright browser once
npm run dev:e2e                     # reset + migrate + seed + dev server for e2e
```

The local email provider is `outbox`: verification/reset mails are printed to
the dev-server console and stored in the `mail_log` table. No external service
is needed for development.

## Architecture

```
src/
  client/          React + Vite PWA (mobile-first, bottom nav on small screens)
    pages/         Today, Plan, Workout player, Log, Progress, Account, Admin,
                   onboarding, auth pages
    offline/       IndexedDB workout draft/event store (offline-first logging)
    i18n/          en (source), nl, fr, de dictionaries + runtime switcher
  domain/          Pure, deterministic rules engines (unit-tested, no I/O):
                   plan generation & periodisation, adaptation proposals,
                   safety rules, nutrition targets, plan validation
  shared/          Zod contracts + TypeScript types shared by client & server
  server/          Hono app on Cloudflare Workers
    routes/        /api/v1/* — auth, onboarding, plans, workouts (+sync),
                   safety, adaptation, nutrition, progress, planner, reports,
                   billing (+ Stripe webhook), catalog, files, notifications,
                   admin/*
    services/      Stripe, mail (Resend/outbox), AI (template/OpenAI),
                   PDF reports (pdf-lib → private R2), workout sync,
                   plan/adaptation/billing services
    middleware/    auth (session cookie), RBAC, error envelope, rate limits
    cron.ts        hourly dunning reminders + nightly cancellations/cleanup
migrations/        versioned Wrangler D1 migrations (schema + core seeds)
seed/              approved demo catalogue (exercises, translations, meals)
e2e/               Playwright: member flow, safety, RBAC, i18n
tests/             vitest: unit (domain), component, workers (integration)
```

Key decisions:

- **Deterministic plan engine.** AI (when configured) only drafts explanations
  or chooses from allowed options; exercises always come from the approved,
  versioned catalogue. If the AI provider is unavailable, everything still
  works with the template fallback.
- **Server-side RBAC.** Member/admin/support roles are enforced in Workers
  middleware; admin actions write audit logs (actor, role, target, before/after).
- **Offline-safe workouts.** Sets, timers and notes are persisted to IndexedDB
  with explicit saved/waiting/synced/attention states; conflicts are surfaced,
  never silently overwritten; planned vs actual values are both retained.
- **Billing via Stripe-hosted Checkout/Portal.** Entitlement changes only from
  signature-verified webhooks (idempotent by event id). Failed payments email
  daily reminders; after 14 unpaid days the subscription is cancelled
  automatically without deleting data.
- **Privacy by design.** Progress photos and pain notes are extra-sensitive;
  R2 objects are private and served via signed URLs; data export and account
  deletion are self-service; no health data is used for advertising.

## Scripts

| Script                                         | Purpose                                                         |
| ---------------------------------------------- | --------------------------------------------------------------- |
| `npm run dev`                                  | Vite dev server with the Cloudflare Workers plugin              |
| `npm run build`                                | Production build (`dist/` client assets + worker bundle)        |
| `npm run lint` / `lint:fix`                    | ESLint (typescript-eslint + react hooks)                        |
| `npm run typecheck`                            | `tsc` for client and server configurations                      |
| `npm test`                                     | vitest: domain unit + component tests                           |
| `npm run test:workers`                         | vitest in the Workers runtime (API integration, cron)           |
| `npm run test:e2e`                             | Playwright end-to-end (needs `dev:e2e` or a running dev server) |
| `npm run db:migrate` / `db:seed`               | local D1 migrations / approved demo seed                        |
| `npm run db:migrate:remote` / `db:seed:remote` | same, against remote D1                                         |
| `npm run admin:create`                         | bootstrap the first admin (env-driven, no hard-coded creds)     |
| `npm run deploy` / `deploy:dry`                | `wrangler deploy` (optionally dry-run)                          |

## Deployment

One path: **local dev → GitHub → Cloudflare Workers Builds (Git integration) →
Workers deployment**, with preview environments per pull request. See
[DEPLOYMENT.md](./DEPLOYMENT.md) for the full guide (D1/R2/KV setup, Stripe,
Google/Apple OAuth, email, PWA verification, admin bootstrap, runbooks and the
security/privacy checklist).

## Verification status

- `npm run typecheck` — passing
- `npm run lint` — 0 errors (2 react-refresh warnings on context files)
- `npm test` — 50 passing
- `npm run test:workers` — 14 passing (auth+CSRF, workout sync & conflict
  resolution, member flow, cron idempotency incl. 14-day cancellation)
- `npm run build` + `wrangler deploy --dry-run` — passing
- `npx playwright test` — member flow (signup→onboarding→plan→log→finish),
  onboarding validation, urgent pain safety flow, member/admin RBAC,
  locale switching (desktop + mobile projects)

## Boundaries and known follow-up work

- **Licensing/legal:** medical/safety copy and thresholds are conservative
  placeholders pending qualified review (`TODO(safety)`, `TODO(legal)`).
- **Food data:** meal logging uses member-entered descriptions with honest
  "rough estimate" labelling. No unlicensed food database is bundled; the
  data model is ready for a licensed provider.
- **AI:** defaults to the deterministic `template` provider; OpenAI-compatible
  provider is optional, server-side only, and never required for core flows.
- **Apple Sign In / Google OAuth** require third-party app setup — flows are
  implemented and degrade gracefully when credentials are absent.
- **R2 media:** the exercise catalogue supports media metadata + captions;
  the initial seed ships text instructions only (no bundled video assets).
- **Push notifications** are limited to in-app + email in this release; Web
  Push can be added later without schema changes.
- Native apps, wearables, barcode scanning and social features are
  deliberately out of scope but not architecturally blocked.
