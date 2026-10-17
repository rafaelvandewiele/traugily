# Deploying Traugily

Traugily deploys as **one Cloudflare Worker** (API + static assets + Stripe
webhooks + cron). The path is: local development → GitHub → Cloudflare
Workers Builds (Git integration) → Workers deployment, with a preview
environment per pull request.

## 1. Prerequisites

| Item                        | Notes                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------- |
| Node.js ≥ 22                | `node -v`; npm included                                                                                 |
| Cloudflare account          | Free plan is enough for development; paid plan recommended for production (R2/KV usage, custom domains) |
| GitHub account + repository | See §2                                                                                                  |
| Wrangler auth               | `npx wrangler login` (browser) or `CLOUDFLARE_API_TOKEN` CI token                                       |
| Stripe account              | Test mode first; live keys for production (§6)                                                          |
| Google Cloud project        | OAuth client for Google Sign-In (§7)                                                                    |
| Apple Developer account     | Service ID + key for Apple Sign In (§8). Optional for launch                                            |
| Email provider              | Resend (recommended) or any Resend-compatible API; `outbox` for local dev (§9)                          |
| AI provider (optional)      | OpenAI-compatible API. Everything works with the deterministic `template` provider without a key        |

## 2. GitHub repository and Cloudflare connection

```bash
# in the project root
git init -b main
git add .
git commit -m "Traugily initial commit"
git remote add git@github.com:<you>/<repo>.git
git push -u origin main
```

Then in the Cloudflare dashboard: **Workers & Pages → Create → Worker →
Import a repository** (Workers Builds / Git integration), authorize GitHub,
select the repository.

- **Production branch:** `main`
- **Preview branch:** create a `preview` branch, or enable preview builds for
  pull requests (recommended). Preview builds get `*.workers.dev` URLs and use
  the `preview` environment defined in `wrangler.jsonc`.
- **Build command:** `npm run build`
- **Deploy command:** `npx wrangler deploy`
- Add the Cloudflare GitHub app so pushes and PRs trigger builds.

Set required secrets in the repo/environment settings (see §5) — never commit
`.dev.vars`.

## 3. Cloudflare resources

All commands use Wrangler; the dashboard equivalents are noted.

```bash
npx wrangler login                                  # once

# D1 databases (one per environment)
npx wrangler d1 create traugily-db-preview          # note the returned database_id
npx wrangler d1 create traugily-db-production

# R2 buckets
npx wrangler r2 bucket create traugily-media-preview
npx wrangler r2 bucket create traugily-media-production

# KV namespaces (rate limits, OAuth state, short-lived cache)
npx wrangler kv namespace create CACHE --preview   # note the id
npx wrangler kv namespace create CACHE
```

Copy the returned IDs into `wrangler.jsonc`:

- `env.production.d1_databases[0].database_id` → `REPLACE_WITH_PRODUCTION_D1_ID`
- `env.production.kv_namespaces[0].id` → `REPLACE_WITH_PRODUCTION_KV_ID`
- `env.preview.*` likewise
- update `vars.APP_URL` for both environments to your real domains
- set `vars.STRIPE_PRICE_ID` per environment (§6)

**Custom domain:** Workers → _traugily_ → Settings → Domains & Routes → Add
custom domain (e.g. `app.traugily.example`). Cloudflare provisions the TLS
certificate automatically. Update `APP_URL` to match.

**Cron triggers** are already configured in `wrangler.jsonc`:

- `17 * * * *` — billing reminders + report/stuck-job maintenance (idempotent)
- `40 4 * * *` — 14-day delinquency cancellations + expired-token cleanup

## 4. Migrations and seed data

Schema changes are versioned Wrangler migrations in `migrations/`. **Never
edit an applied migration — add a new one.**

```bash
npx wrangler d1 migrations apply traugily_db --local       # local dev
npx wrangler d1 migrations apply <preview-db-name> --remote --env preview
npx wrangler d1 migrations apply <prod-db-name>  --remote --env production

# approved demo content only (exercise catalogue, translations, meal ideas)
node scripts/seed.mjs --local
node scripts/seed.mjs --remote --env production           # optional; see below
```

Production safety:

- take a backup before applying migrations:
  `npx wrangler d1 export <db> --remote --output backup-$(date +%F).sql`
- apply migrations during a quiet window; Workers Builds can also run them as
  a build step once you are confident (not enabled by default)
- `seed/` contains only approved, non-personal demo content — it is safe for
  production, but skipping it is also fine (an admin can publish exercises
  via `/admin`)
- D1 has no automatic point-in-time restore on free tiers — schedule the
  export above (see §13)

## 5. Environment variables and bindings

`.dev.vars.example` documents every variable; copy it to `.dev.vars` locally.
In Cloudflare: Workers → _traugily_ → Settings → Variables. **Secrets** go in
"Secret variables"; plain values in "Environment variables" (per environment:
preview/production).

| Variable                                                  | Secret?      | Description                                                         |
| --------------------------------------------------------- | ------------ | ------------------------------------------------------------------- |
| `ENVIRONMENT`, `APP_URL`, `SUPPORT_EMAIL`, `LOG_LEVEL`    | no           | core config; set per environment                                    |
| `EMAIL_PROVIDER`                                          | no           | `resend` in production, `outbox` locally                            |
| `RESEND_API_KEY`                                          | **yes**      | transactional email API key                                         |
| `RESEND_FROM`                                             | no           | verified sender, e.g. `Traugily <onboarding@mail.traugily.example>` |
| `AI_PROVIDER`                                             | no           | `template` (default, deterministic) or `openai`                     |
| `AI_API_KEY`, `AI_API_BASE_URL`                           | **yes** / no | only when `AI_PROVIDER=openai`                                      |
| `STRIPE_SECRET_KEY`                                       | **yes**      | test key first; live key for production                             |
| `STRIPE_WEBHOOK_SECRET`                                   | **yes**      | signing secret of the webhook endpoint (§6)                         |
| `STRIPE_PRICE_ID`, `STRIPE_CURRENCY`, `STRIPE_TRIAL_DAYS` | no           | per-environment price/currency/trial                                |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`               | no / **yes** | Google Sign-In (§7)                                                 |
| `APPLE_CLIENT_ID` / `APPLE_CLIENT_SECRET`                 | no / **yes** | Apple Sign In (§8)                                                  |
| `ASSET_SIGNING_SECRET`                                    | **yes**      | signs private R2 asset URLs; `openssl rand -base64 32`              |

Bindings (already in `wrangler.jsonc`): `DB` (D1), `MEDIA` (R2), `CACHE` (KV),
`ASSETS` (static assets). Least privilege: the Worker only receives these.

In GitHub (Workers Builds → environment variables/secrets) mirror what the
build needs — the build itself needs no secrets for this project, but keeping
preview/production values scoped per environment is recommended.

Rotate secrets with:

```bash
npx wrangler secret put RESEND_API_KEY --env production
npx wrangler secret put STRIPE_WEBHOOK_SECRET --env production
# …repeat per secret
```

## 6. Stripe

1. **Product:** Stripe Dashboard → Products → New product "Traugily Premium",
   one **recurring price** (monthly, €5.00, currency EUR). Note the price id
   (`price_…`) → set as `STRIPE_PRICE_ID` per environment.
2. **Webhook endpoint:** Developers → Webhooks → Add endpoint, URL
   `https://app.traugily.example/api/v1/billing/webhook` (use the preview URL
   for the preview environment). Select events:
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`.
3. Copy the **Signing secret** (`whsec_…`) → `STRIPE_WEBHOOK_SECRET`.
4. **Checkout:** the app creates Stripe-hosted Checkout sessions server-side
   (`/api/v1/billing/checkout`); success/cancel URLs derive from `APP_URL`.
5. **Customer Portal:** Developers → Customer Portal → enable; the app opens
   it from Account (`/api/v1/billing/portal`).
6. **Entitlements** change only from signature-verified webhooks; processing
   is idempotent by Stripe event id (`billing_webhook_events`), so retried
   deliveries are safe.
7. **Invoice emails:** Stripe sends invoices by default; the app also emails a
   payment-success note referencing the invoice on `invoice.paid`.
8. **Local webhook testing:**
   `npx stripe listen --forward-to http://localhost:5173/api/v1/billing/webhook`
   and put the printed `whsec_…` in `.dev.vars`.
9. **Retry testing:** Dashboard → Webhooks → your endpoint → "Resend" an
   event; confirm no duplicate entitlement/reminder rows.

Failed payments: the hourly cron writes daily reminders (email + in-app) while
`past_due`; the nightly cron cancels subscriptions still unpaid after 14 days
without deleting any member data. Both are deterministic and covered by tests.

## 7. Google OAuth

1. Google Cloud Console → APIs & Services → Credentials → OAuth client ID →
   **Web application**.
2. Authorized JavaScript origins:
   - `http://localhost:5173`
   - `https://preview.<…>.workers.dev` (preview URL)
   - `https://app.traugily.example`
3. Authorized redirect URIs (same three origins):
   `/api/v1/auth/google/callback` on each origin.
4. Set `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`. Until configured, the
   Google button is hidden/disabled and password auth keeps working.

## 8. Apple Sign In

1. Developer Account → Identifiers → create a **Services ID** (e.g.
   `com.traugily.web`) and enable **Sign In with Apple** for it as a primary
   or secondary provider.
2. Configure the Services ID: domains `app.traugily.example` (+
   preview/localhost for testing) and return URL
   `https://app.traugily.example/api/v1/auth/apple/callback`.
3. Create a **Sign in with Apple key**, download the `.p8`, and generate a
   client secret (ES256 JWT: team id, key id, bundle id) with any JWT tool;
   set it as `APPLE_CLIENT_SECRET`, and the Services ID as `APPLE_CLIENT_ID`.
4. Local/preview limitations: Apple requires the exact registered domains, so
   Apple Sign In typically only works on production (and on registered preview
   domains). The app degrades gracefully when the variables are absent.

## 9. Transactional email

1. Create a Resend account, verify your sending domain (add the DKIM/SPF DNS
   records Resend shows you).
2. Set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` (secret), and
   `RESEND_FROM="Traugily <onboarding@mail.traugily.example>"`.
3. Templates cover: verify email, password reset, welcome, payment success
   (with invoice link), payment failed (with manage-billing link), report
   ready. Copy lives in `src/server/lib/mail-strings-*.ts` (en/nl/fr/de).
4. Fallback/error expectations: with `EMAIL_PROVIDER=outbox` (local) or when
   the provider errors, mails are recorded in the `mail_log` table with a
   `failed` status — auth and core flows never hard-fail because email is
   down, and the admin dashboard surfaces delivery problems.

## 10. PWA verification

- `public/manifest.webmanifest`: name "Traugily", `display: standalone`,
  theme colors, icons (192/512 + maskable), shortcuts.
- `public/sw.js`: app-shell + static-asset caching, network-first for API,
  never caches authenticated responses. Version bump on deploy triggers
  refresh.
- **Android (Chrome):** open the site → install icon in the omnibox →
  confirm standalone launch, offline start, and the "Today" shortcut.
- **iOS (Safari):** Share → Add to Home Screen → confirm standalone display,
  status-bar styling, and that a workout continues while offline (airplane
  mode) and syncs after reconnecting.
- Check `chrome://install` / Lighthouse → PWA for installability errors.

## 11. Admin bootstrap and operations

```bash
# create the first admin (prints a one-time random password) or promote a user
npx wrangler d1 execute <db> --remote --command "…"   # not needed; use:
npm run admin:create -- --email you@example.com --remote
```

The script never hard-codes credentials; it generates a random password and
prints it once (force a change after first login). All `/admin` routes are
guarded by server-side role checks (`admin`), and every sensitive action
writes an audit row (actor, role, timestamp, target, before/after summary —
never sensitive free text).

- **Inspect audit logs:** `/admin` → Audit, or
  `npx wrangler d1 query <db> --remote "SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 50"`.
- **Feature flags:** `/admin` → Flags, or the `feature_flags` table; toggles
  take effect immediately and are audited.
- **Content management:** `/admin` → Exercises/Nutrition/Safety rules with
  draft → review → published lifecycle, translations and version history.
- **Secret rotation:** §5. After rotating Stripe/Google/Apple secrets, verify
  a login and a webhook delivery before closing the old credentials.

## 12. Local development → preview → production

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate && npm run db:seed
npm run dev                        # http://localhost:5173

npm run lint && npm run typecheck
npm test && npm run test:workers
npx playwright install chromium && npm run dev:e2e & npm run test:e2e

npm run build && npm run deploy:dry    # validate config without deploying
npx wrangler deploy --env preview      # manual preview deploy (optional)
git push origin preview                # or open a PR → Workers Builds preview
git push origin main                   # production via Workers Builds
```

**Rollback:** Workers keeps deployments per environment — Cloudflare
dashboard → Workers & Pages → _traugily_ → Deployments → select the previous
version → **Rollback** (or `npx wrangler rollback`). D1 migrations are
forward-only: roll back application code first; for bad schema changes add a
new corrective migration.

**Troubleshooting:**

- `wrangler deploy` fails on config → validate IDs in `wrangler.jsonc`;
  `npx wrangler deploy --dry-run` prints the problem.
- 5xx on API calls → dashboard → Workers → Logs, or query
  `operational_events` (kind `unhandled_error`, privacy-conscious detail).
- Webhook 400s → check `STRIPE_WEBHOOK_SECRET` matches the endpoint and the
  raw body is used (the Worker verifies signatures server-side).
- D1 "no such table" → migrations not applied to that environment; run §4.
- Email not arriving → check `mail_log` and the provider dashboard; outbox
  mode never sends externally.
- OAuth redirect mismatch → origins/redirect URIs must match exactly per
  environment (§7/§8).

## 13. Security & privacy operating checklist

- [ ] Backups: scheduled `wrangler d1 export` per environment; verify a
      restore drill quarterly. R2 versioning/lifecycle per bucket policy.
- [ ] Access review: quarterly review of Cloudflare/GitHub/Stripe members and
      API tokens; use scoped tokens and rotate on staff changes.
- [ ] Secret rotation: Stripe, Google, Apple, Resend, `ASSET_SIGNING_SECRET`
      rotated at least annually and after any suspected exposure.
- [ ] Data export/deletion: self-service in Account (export JSON, delete
      account). Honour requests within your legal timeframe; deletion removes
      profile/workout/nutrition rows and schedules R2 object deletion
      (retention status is shown to the member).
- [ ] R2 object access: buckets are private; media is served only via
      signed, expiring URLs after ownership checks. Audit
      `asset_objects` periodically.
- [ ] Rate limits: auth, uploads, reports, AI and sync endpoints are
      limited via KV counters; alert if counters spike.
- [ ] Logs: Worker observability enabled; logs contain request ids, never
      health-like free text. Review `operational_events` weekly.
- [ ] Legal/privacy review before launch: privacy policy, consent wording
      (marketing, notifications, photos, future integrations), GDPR records
      (lawful basis, retention), medical/safety disclaimer copy, and all
      `TODO(safety)`/`TODO(legal)` items in the codebase.
- [ ] Payments: Stripe tax/VAT configuration reviewed for your jurisdiction;
      billing emails match your legal entity.
