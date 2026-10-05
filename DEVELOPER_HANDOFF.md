# Versa developer handoff

## Contents

1. [Snapshot and executive summary](#snapshot-and-executive-summary)
2. [Start here: safe onboarding](#start-here-safe-onboarding)
3. [Architecture and source map](#architecture-and-source-map)
4. [Role-by-role feature matrix](#role-by-role-feature-matrix)
5. [Domain rules and financial safeguards](#domain-rules-and-financial-safeguards)
6. [Configuration reference](#configuration-reference)
7. [Quality and security](#quality-and-security)
8. [Operations, release and portability](#operations-release-and-portability)
9. [Prioritized completion roadmap](#prioritized-completion-roadmap)
10. [First-week transition and smoke scenarios](#first-week-transition-and-smoke-scenarios)
11. [Readiness and access-transfer checklists](#readiness-and-access-transfer-checklists)
12. [Task-status appendix](#task-status-appendix)

## Snapshot and executive summary

**Source baseline:** `7406c228a2c418b231d99da879a838765c29d9fb`.
**Inspection date:** 2026-10-05 UTC. Task statuses were refreshed during preparation; see the appendix for the final board refresh. This document describes the checked-out source, not unmerged branches. Refresh it after merges; task statuses and provider configuration can change independently of this revision.

Versa is a Cyprus futsal marketplace with three roles: PLAYER, VENUE_OWNER and ADMIN. An Expo/React Native client talks to an Express API backed by PostgreSQL/Drizzle. The source includes venue discovery, booking, payment/cancellation, owner management, admin oversight, subscriptions, Pro statistics/analytics/manual bookings/reminders, and Elite matchmaking/waitlists/leaderboards/tournaments. It is **not established as launch-ready**.

The display brand is Versa. `FutsalCY` remains in the artifact/package name, README, older project notes, persisted client keys, demo identities and some Stripe/deep-link copy. Do not bulk-rename these: changing storage keys or app identifiers can break existing sessions/installations.

### Evidence boundary

| Evidence | What it establishes | What it does not establish |
|---|---|---|
| Current file inspection | Routes, UI entry points, schemas, scripts and safeguards exist in this checkout | Correct runtime behavior, delivered messages, settled funds or native compatibility |
| Refreshed task board and selected full plans | Delivery status and reported risks, including prior test reports | That a Draft describes a still-reproducible failure; that Ready work is merged |
| Prior reports in task plans | #110 reports feature suites passed after isolated provisioning, but clean bootstrap failed; #113 reports database/provider concurrency coverage unavailable at that time | Fresh test passes or current environment availability |
| Checks performed for this handoff | Read-only source/task inspection; document path/script/navigation/redaction checks | App builds, typechecks, tests, database setup, security scans, provider rehearsals or production readiness |

No builds, package installation, application tests, schema changes, shared-database seeding, production queries, paid transactions, message delivery or deployment were performed for this documentation task. “Source-present” below always means **unverified in this handoff**. Merged means delivery status, not tested or approved for production.

### Immediate risks and contradictions

- #102 (Build Elite tournament creator) is Merged and its source is present. #100 (Add Pro growth tools) remains separate work; do not attribute its planned discount/streak behavior to this checkout.
- #13 (Route booking payments to the owner's Stripe account at checkout) and #96 (Restore form behavior after motion) are Ready. The current payment provider already uses Connect destinations if an account ID exists, but does not check charge/payout readiness at charge creation. Inspect the pending change when merged rather than treating routing as wholly absent or fully resolved.
- #11 and #74 record historic build/typecheck issues. No current failure count was reproduced here.
- #110 records clean-database failure. The journal visibly omits the guest-column migration and contains non-monotonic timestamps; new bootstrap remains a release gate, not a guaranteed command.
- #106 and #113 are configuration/verification gaps, not evidence that delivered reminders or concurrent tournaments work.
- The [plans screen](artifacts/futsalcy/app/%28owner%29/plans.tsx) still calls insights/reminders, tournaments, matchmaking/waitlists and leaderboards “coming soon” despite source being present. Growth tools are also “coming soon”, consistent with unmerged work.
- [replit.md](replit.md) describes an obsolete €1 fee and unconditional mock success. Current default is a configurable **6% added to the paid booking base**, with Stripe selected when its server key is present and a deliberate mock-decline switch. README onboarding is abbreviated and not a clean-bootstrap guarantee.

Specific Draft/source mismatches worth resolving before assigning new work:

| Task record | Current observation | Correct interpretation |
|---|---|---|
| #7 pitch-edit warnings | Venue route rejects conflicting slot-duration edits with 409 | Draft seeks proactive UI/actionable conflict links, not a wholly missing server guard |
| #11 old avatar type errors | Avatar route currently writes local files, not the older object-storage calls described in the plan | Reproduce current typecheck; do not blindly repair obsolete API calls |
| #30 push handler | Shared push hook currently registers a foreground notification handler | Device/background proof still needed; “no handler” claim is stale or needs narrower reproduction |
| #35 upload error propagation | customFetch already has structured API-error handling | Verify the actual error text reaches the avatar UI before adding duplicate parsing |
| #36 avatar cache | Plan describes old signed object-storage URLs; local avatar response already adds a version query | Revalidate current cache behavior and durable-host risk rather than implementing the old storage premise |
| #47 audit title | Full plan asks for filtering/search/date narrowing in existing Activity history | Do not assume the title means no inline history exists |
| #55 match finished | Dispatcher already sends MATCH_FINISHED for elapsed confirmed bookings; there is no COMPLETED booking enum | Player-driven completion/recap is a separate product decision, not proof that all notifications lack triggers |
| #94 Connect verification | Plan describes charges-enabled routing from pending #13 work; baseline only sees stored account ID | Keep pending-branch reported behavior separate from inspected code |
| #115/#116 growth follow-ups | Plans refer to aggregate summaries and isolated/provider-stub checks from growth work not in this checkout | Treat those as branch-reported evidence, not inspected source or Stripe rehearsal |

## Start here: safe onboarding

### 1. Establish an isolated development environment

Read this document, [SECURITY.md](SECURITY.md), [package.json](package.json), [pnpm-workspace.yaml](pnpm-workspace.yaml) and [.replit](.replit). Record your revision and refresh the task board before changing financial or generated-contract code. Use Node.js 24 (the workspace runtime), pnpm and PostgreSQL 16 (the configured Replit module). The repository does not pin a pnpm `packageManager` version; agree one with the team and use the lockfile. Bash is needed by several scripts. Native testing needs physical iOS/Android devices and later signed development builds; iOS local native builds require Apple's toolchain.

```bash
# Repository root; installs packages, but does not initialize the database.
pnpm install --frozen-lockfile
```

The preinstall hook requires pnpm and removes npm/yarn lockfiles. Native Sharp/esbuild dependencies and workspace platform exclusions in `pnpm-workspace.yaml` are Linux-oriented; review these for macOS/Windows rather than assuming portable installation.

Provision a **new, disposable PostgreSQL database**. Configure `DATABASE_URL` to that database through your private environment/secrets manager, not source control. Never print connection strings or copy `.env.local`/secret exports into issues. Configure `JWT_SECRET` and an API `PORT`. See [configuration](#configuration-reference) before enabling any provider. Missing Stripe server key enables mock payments; this is convenient for an isolated demo, unsafe as an accidental production setting.

### 2. Treat database initialization as a known blocker

The intended migration command exists:

```bash
pnpm --filter @workspace/db run migrate
```

**Only run against your isolated database after reviewing the migration chain. This is not yet a proven clean-bootstrap recipe.** Inspect [the journal](lib/db/migrations/meta/_journal.json), [guest-column migration](lib/db/migrations/0006_guest_booking_columns.sql), [manual-source migration](lib/db/migrations/0026_manual_booking_source.sql), [match-statistics migration](lib/db/migrations/0025_match_statistics.sql), [schema reconciliation](lib/db/migrations/0028_reconcile_schema_drift.sql), [tournament migration](lib/db/migrations/0025_elite_tournaments.sql) and [tournament payment hardening](lib/db/migrations/0026_tournament_payment_hardening.sql).

- `0006_guest_booking_columns.sql` exists but has no journal entry. Later migrations use `guest_name`/`guest_phone`; applying SQL files alphabetically is not equivalent to journal execution.
- Journal `idx`, timestamps and numeric filename prefixes do not provide one consistent chronology. Some later entries have earlier timestamps; several independent migrations share prefixes/timestamps. Inspect actual Drizzle application history and ordering, not just filenames.
- Match-statistics composite foreign keys depend on parent unique indexes. The [prerequisite helper](scripts/prepare-schema-push.cjs) creates two indexes when parent tables exist; it is **DDL**, not a read-only check.
- [Post-merge setup](scripts/post-merge.sh) installs dependencies, runs that helper and pushes schema. It also scans output because Drizzle can report PostgreSQL errors while exiting zero. Do not execute it on a shared or production database just to “check setup”.
- [Database scripts](lib/db/package.json) also expose `push`, `push-force` and `generate`. `push` is development schema reconciliation, not reviewed production migration history; `push-force` must not be a default bootstrap fix. Generation can prompt about renames/retypes; hand-authored migrations need reviewed journal entries.
- A pushed development schema can mask missing migrations. Do not mark #110 complete merely because a pre-provisioned database runs features.

Incoming developer's first database deliverable: make reviewed migration history succeed on an empty disposable database and a representative existing-schema copy, inspect constraints/columns, then prove setup is repeatable without data loss. Back up before any non-disposable schema change. Obtain approval before modifying production.

### 3. Optional demo seed, isolated database only

After schema verification, set `DEMO_SEED_PASSWORD` privately to a unique non-production password that passes the app's policy, then:

```bash
pnpm --filter @workspace/api-server run seed
```

[Seed source](artifacts/api-server/src/seed.ts) creates demo player, **two owners**, an admin, two venues with five pitches, opening hours/pricing, and enabled 6% settings when missing. Venues start pending approval. Existing users/settings can be skipped; rerunning is not a promise to reset passwords or repair every partial seed. README lists only one of the owners. Use demo identities from seed source; this handoff intentionally does not reproduce names, phone numbers or account passwords. Never seed shared/production data.

### 4. Start API and client

```bash
# API: builds the bundle then starts it; this is not a watch command.
PORT=8080 pnpm --filter @workspace/api-server run dev

# In another terminal, Replit development client:
pnpm --filter @workspace/futsalcy run dev
```

API listens using `PORT`; root router is `/api`. `GET /api/healthz` returns 200 only after a successful `SELECT 1`, otherwise 503; it does not validate schemas/providers/jobs.

The configured Replit workflows are:

| Workflow | Command | Routing |
|---|---|---|
| `artifacts/api-server: API Server` | `pnpm --filter @workspace/api-server run dev` | API artifact at `/api`, process port 8080, shared external HTTP port 80 |
| `artifacts/futsalcy: expo` | `pnpm --filter @workspace/futsalcy run dev` | Expo-domain routing, process port 20728, external port 3000, client preview `/` |
| `artifacts/mockup-sandbox: Component Preview Server` | `pnpm --filter @workspace/mockup-sandbox run dev` | Design canvas at `/__mockup`, port 8081; not a product backend |

Use those existing workflows in Replit, not duplicate servers. Restart the relevant workflow after a batch of runtime/package changes; inspect logs and health before diagnosing the preview. This documentation change does not require restarting anything.

### 5. Understand native, web and Metro differences

- [Root layout](artifacts/futsalcy/app/_layout.tsx) uses the browser hostname on web, stripping `.expo.` to reach the API host. Native uses `EXPO_PUBLIC_DOMAIN` as a **hostname without protocol**, with `https://` added. It is compiled into the bundle: rebuild/rescan after host changes (#6). A device's `localhost` is not the development computer.
- [Development launcher](artifacts/futsalcy/scripts/start-dev.mjs) overwrites `.env.local` with `EXPO_PUBLIC_DOMAIN` from `REPLIT_DEV_DOMAIN` and the public Replit ID. It requires `cloudflared`, starts a temporary quick tunnel to Metro, then advertises an HTTP `EXPO_PACKAGER_PROXY_URL` for Expo Go. Tunnel addresses change each run; scan the current QR. A tunnel 502 does not prove Metro is dead. These are development tunnels, not release hosting.
- Historical routing notes must not override this launcher. Web/API and packager/tunnel addresses serve different purposes. Restart Metro after Expo dependency replacement; stale file watchers can retain deleted package paths.
- Outside Replit, avoid the launcher unless you deliberately supply its Replit-specific inputs. Direct commands available through the installed Expo CLI include `pnpm --filter @workspace/futsalcy exec expo start --web --port 20728` and `pnpm --filter @workspace/futsalcy exec expo start --host lan --port 20728`. These are documented commands, not exercised here. Configure a reachable HTTPS API host for native; web currently expects `/api` on its own derived host, so provide a reverse proxy or deliberately adapt the base URL. No localhost backend fallback is implemented.
- [Stripe web shim](artifacts/futsalcy/lib/stripe-native.ts) returns `WebUnsupported`; [native shim](artifacts/futsalcy/lib/stripe-native.native.ts) re-exports the native SDK. Do not import Stripe React Native directly into universal/web code. The web saved-card route has its own `.web.tsx`. **Source supporting web browsing is not evidence of functional web card checkout.**
- Android Expo Go skips remote push registration; SDK 53+ removed that capability there. [Push hook](artifacts/futsalcy/hooks/usePushNotifications.ts) also skips web and simulators/non-devices. Use signed development/store builds on physical devices to prove push. Native Stripe and keyboard-controller behavior also need the correct development build; Expo Go previews are not store-release evidence.
- [App configuration](artifacts/futsalcy/app.json) uses scheme `versafutsalapp`, platform identifiers `com.versafutsalapp.app`, and a Stripe merchant identifier. Its Google Pay plugin option is disabled. These are configuration declarations, not Apple Pay/domain/store approval. No `eas.json` was found in this checkout.
- [Static build script](artifacts/futsalcy/scripts/build.js) assumes Metro on 8081, which collides with the canvas server. It clears build/cache output and captures native bundles/manifests; do not run it while another service owns 8081. `build`/`serve` are not a demonstrated production web SPA or native-store pipeline.

## Architecture and source map

```text
Expo Router screens → auth/context + React Query hooks + customFetch
                                      ↓ HTTPS /api + bearer JWT
Express middleware → domain routes → domain helpers → Drizzle / pg → PostgreSQL
                           ↓                   ↓
                 Stripe / Resend         in-process periodic jobs
                 Expo Push / SMS         notifications, SMS, Elite recovery
                 object storage          durable state in PostgreSQL
```

### Boundaries and ownership

| Area | Source entry | Maintenance guidance |
|---|---|---|
| Client navigation, providers, fonts, motion | [client app](artifacts/futsalcy/app/), [root layout](artifacts/futsalcy/app/_layout.tsx), [components](artifacts/futsalcy/components/), [contexts](artifacts/futsalcy/context/) | Expo Router role groups are UI navigation, not authorization; server guards are authoritative. Feather font workaround uses a unique font name for Android Expo Go. |
| Auth/session persistence | [AuthContext](artifacts/futsalcy/context/AuthContext.tsx), [auth middleware](artifacts/api-server/src/middlewares/auth.ts), [auth routes](artifacts/api-server/src/routes/auth.ts) | Native SecureStore with legacy AsyncStorage migration/fallback; cached user/mode remain AsyncStorage. API verifies session version/deletion on every authenticated request. |
| API boot and transport | [index](artifacts/api-server/src/index.ts), [app](artifacts/api-server/src/app.ts), [route registry](artifacts/api-server/src/routes/index.ts), [validation middleware](artifacts/api-server/src/middlewares/request-validation.ts) | API binds `PORT`, mounts `/api`, saves raw JSON bytes for webhook signatures. General CORS is currently permissive. |
| Domain API | [routes directory](artifacts/api-server/src/routes/) | Groups: auth; public/owner venues/pitches/pricing/hours/photos/blocks; bookings/payment; player/owner account and notifications; favourites; admin venues/users/refunds/audit; subscriptions; match statistics; leaderboard; Elite; tournaments. |
| Shared contract and generation | [OpenAPI](lib/api-spec/openapi.yaml), [Orval configuration](lib/api-spec/orval.config.ts), [React client](lib/api-client-react/src/), [custom fetch](lib/api-client-react/src/custom-fetch.ts), [Zod exports](lib/api-zod/src/index.ts), [handwritten policies](lib/api-zod/src/secure.ts) | Spec drives generated types/hooks and Zod. Handwritten validation is the security boundary; don't hand-edit generated outputs. Generated Zod export is nested `generated/api/api`, not a stale sibling. |
| Persistence | [DB package](lib/db/package.json), [pool](lib/db/src/index.ts), [schema](lib/db/src/schema/), [migrations](lib/db/migrations/) | PostgreSQL constraints/transactions underpin concurrency. Review runtime schema plus migration history; keep them aligned. |
| Background work | [notifications](artifacts/api-server/src/lib/notifications.ts), [SMS jobs](artifacts/api-server/src/lib/sms-reminders.ts), [Elite recovery](artifacts/api-server/src/lib/elite.ts) | Started by API process: push/reminder and SMS ticks 60 seconds, Elite recovery 30 seconds. Not separate durable scheduler services. |
| Providers and files | [payment provider](artifacts/api-server/src/lib/payment-provider.ts), [reset email](artifacts/api-server/src/lib/password-reset-email.ts), [SMS adapter](artifacts/api-server/src/lib/sms-provider.ts), [photo storage](artifacts/api-server/src/lib/venue-photo-storage.ts), [avatar route](artifacts/api-server/src/routes/player-avatar.ts) | Stripe direct SDK; Resend through Replit connectors; custom HTTP SMS protocol; venue images in Replit storage but avatars on process filesystem. |
| Development preview | [canvas artifact](artifacts/mockup-sandbox/), [.replit](.replit) | Canvas is supporting component preview, not a separate shipped Versa app. Keep artifacts' routing distinct. |

### Important entity relationships

- Users have roles, password hashes, phone uniqueness/deletion/session-version state, push tokens, optional Stripe customer and owner Connect references.
- Owners → venues → pitches; venues carry approval/disabled state and cancellation policy; hours are per venue/weekday, pricing and maintenance per pitch, availability blocks may apply to a venue or pitch.
- Bookings relate to venue, pitch and player (manual guests are additional fields, not necessarily registered accounts). They retain a policy snapshot and source/offline-payment marker. Payments/refunds and booking audit entries relate to booking activity.
- Notifications retain scheduled/delivery/read state. SMS jobs have attempts, budgets and claim leases.
- Owner subscriptions/events preserve provider state, periods, pending checkout leases, overrides and webhook ordering cursor.
- Match statistics include matches, participants, scores/results and per-player statistics with relational consistency constraints. Leaderboards derive from eligible persisted match history, not card payments or tournament prizes.
- Elite schema includes squad requests/members/availability, proposals, waitlist entries/claims and mutation-rate buckets.
- Tournament schema is separate: tournaments → optional teams → registrations → payment attempts and bracket matches; tournament audit events preserve lifecycle changes. Its ledger is not the ordinary booking payment table.

### Contract-edit workflow

```bash
pnpm --filter @workspace/api-spec run codegen
pnpm run typecheck:libs
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/futsalcy run typecheck
pnpm run typecheck
```

The codegen script itself runs library typechecking. Review generated diffs and handwritten `requestSchemas` mappings together. Orval output can omit object-size rules or alter query coercion/defaults; confirm actual runtime integer limits, enums and required properties. An API capability without UI, or UI without enforced API behavior, is not complete.

## Role-by-role feature matrix

**Legend:** S = source-present; V0 = inspected only, no new runtime verification. All rows are V0, including Merged rows. “Dependencies” lists services needed to prove the flow, not verified current credentials. Entry paths are relative to `artifacts/futsalcy/app/`; server paths are relative to `artifacts/api-server/src/routes/` (both directories linked above). Related task numbers are expanded in the appendix.

| Role / feature and behavior | UI entry → server evidence | Delivery / verification | Dependencies | Limitations and remaining action |
|---|---|---|---|---|
| All: mode selection, registration/login, role routing | `(auth)/mode-select.tsx`, `register.tsx`, `login.tsx`, `index.tsx` → `auth.ts`, auth middleware | S; security #71/#72/#73/#77/#82 Merged; V0 | DB, JWT signing | Mode is not permission. Exercise Unicode/password/unique-phone rules, invalid/deleted/revoked sessions and cross-role rejection. #79/#86. |
| All: password recovery/change | `(auth)/reset-password.tsx`, settings/profile components → `auth.ts`, reset-email helper | S; #80/#83 Merged; V0 | DB, configured Resend sender, HTTPS reset page | Generic request response can hide delivery misconfiguration. Prove published page, single-use expiry and session revocation without exposing tokens. |
| Player: search/discover venues, detail/pitches/available-slot chips | `(player)/index.tsx`, `player/venue/[id].tsx` → `venues.ts`, `bookings.ts` | S; #54 Merged; V0 | DB, images; device location where requested | Only eligible venues should book. Verify filters, empty/blocked states, current availability and UTC/local-time display. |
| Player: favourites and red heart | `(player)/favourites.tsx`, venue cards/detail → `favourites.ts` | S; #53 Merged; V0 | Auth, DB | Prove persistence/removal and all heart renderings (#59); do not confuse local visual state with stored favourite. |
| Player: photo carousel | Venue cards and `player/venue/[id].tsx` → photo endpoints in `venues.ts` | S; #8/#60 Merged; V0 | Object storage | Slow-network/large-image behavior unproven (#64); full-screen viewer remains Draft (#63). |
| Player: select slot, summary, full/deposit checkout | `player/venue/[id]/book.tsx`, `book-summary.tsx` → `bookings.ts`, `payments.ts` | S; #2/#65 Merged; #13 Ready overlap; V0 | DB, Stripe native SDK/Connect or mock | Web native Stripe is unsupported; quote/payment/retry consistency, owner readiness and abandoned checkout need rehearsal (#12/#94). |
| Player: booking history/search/detail/cancel | `(player)/bookings.tsx`, `player/booking/[id].tsx` → `bookings.ts` | S; #51/#39 Merged; V0 | DB, payment provider for refunds | Enforced cancellation window; provider refund not atomic with DB. Future group/name search is conditional (#57), discoverability #58. |
| Player: profile/avatar/city and payment settings | `(player)/profile.tsx`, `player/settings.tsx`, `settings-payments.tsx` plus `.web.tsx` → `player-account.ts`, `player-avatar.ts` | S; #33 Merged; V0 | Local avatar files, Stripe for native saved cards | Avatars differ from durable venue photos. Error handling/cache/session upgrade checks (#35/#36/#86); web card-management limitations. |
| Player/owner: notification inbox, badge and preferences | `player/notifications.tsx`, `owner/notifications.tsx`, push hook → role notification routes | S; #29/#52 Merged; V0 | DB, Expo Push, physical builds | Best-effort push, no web push, Android Expo Go skips push. Background delivery/resume badge/authorization tests #30/#32/#56. Match recap completion UX #55. |
| Owner: onboarding, venue/pitch creation/editing | `owner/onboarding.tsx`, `venue-new.tsx`, `venue/[id].tsx`, venue/pitch `edit.tsx` → `venues.ts` | S; #3/#16/#17 Merged; V0 | DB | Approval gates discovery; Outdoor default source-present. Wizard/edit crash and background persistence #7/#9/#20–#23. |
| Owner: venue photos and ordering/cover | Venue create/edit/manage screens → `venues.ts`, photo storage helper | S; #8/#81 Merged; V0 | Replit object storage, Sharp | Ownership/byte validation exists; prove full lifecycle and cover ordering #88, not merely bucket provisioning. |
| Owner: pitches/pricing/hours/off-days/holidays/maintenance | Venue/pitch management → `venues.ts`, availability and booking helpers | S; #19 Merged; V0 | DB | Existing-booking impact policy and DST semantics require explicit decision/tests; not every block should silently cancel bookings. |
| Owner: dashboard, booking search/calendar/edit/detail | `(owner)/index.tsx`, `bookings.tsx`, `calendar.tsx`, `owner/booking-edit.tsx`, `booking/[id].tsx` → `bookings.ts` | S; #18/#39 Merged; #96 Ready; V0 | DB, auth | Ownership-scoped actions and reason input; form/keyboard/reduced-motion regression must be checked after merge #97. Cancellation alerts #31 may overlap current helper. |
| Owner: stats/revenue/exports | `(owner)/stats.tsx`, booking export → `bookings.ts`, owner analytics/manual-booking helpers | S; V0 | DB, persisted payments/refunds | Financial revenue, booking counts and CSV revenue use different definitions. Fee/refund limitations #10/#12; offline reconciliation #109. |
| Owner: Stripe onboarding/settings | `owner/settings-payments.tsx` → `owner-account.ts` | S; #4/#65 Merged; #13 Ready; V0 | Stripe Express/Connect, APP_DOMAIN | Status refresh and expired link recovery #14/#15; ID alone is not charges/payouts readiness. |
| Owner/admin: subscription plan, billing portal/cancel/override | `(owner)/plans.tsx`, admin users subscription controls → `subscriptions.ts`, entitlements helper | S; #98 Merged; V0 | Stripe recurring prices, webhook, APP_DOMAIN; DB | API entitlement enforcement exists. Plan card €29/€59 monthly is display copy, not verified Stripe pricing. Overrides and recovery need rehearsal. |
| Pro/Elite owner: manual guest booking and offline payment | `owner/booking-new.tsx`, booking detail → manual/offline endpoints in `bookings.ts` | S; #105 Merged; V0 | DB, server entitlement | Pending until offline receipt marked; no Stripe checkout/refund. Receipt UX #108; don't equate provider and offline revenue. |
| Pro/Elite owner/player: match records, scores and statistics | Owner booking detail; player profile/venue detail → `match-statistics.ts` | S; #99 Merged; V0 | DB with match schema, owner entitlement | Ownership and participant/privacy rules, corrections/deletion and score consistency need role tests. Not a universal player “finish session” feature. |
| Pro/Elite owner: premium insights and discovery cues | `(owner)/stats.tsx`, player venue discovery → `bookings.ts`, owner-analytics/venue-discovery helpers | S; #101 Merged; V0 | DB, ADVANCED_ANALYTICS entitlement | Retention/repeat/cancellation confidence thresholds can intentionally return insufficient data. Plans still say coming soon. |
| Pro/Elite owner: automated 24-hour SMS reminders | Booking confirmation/edit/offline receipt paths → SMS helper/jobs/provider | S; #101 Merged; #106/#107 Draft; V0 | HTTP SMS service, phone consent, running worker | Disabled without provider; late-created bookings inside lead window do not schedule. Delivery and opt-in product decisions outstanding. |
| Pro/Elite owner/player: discount codes and weekly loyalty rewards | Planned in #100; no delivered growth model/routes identified in baseline | Active separate branch; not inspected; V0 | Future entitlement, booking/pricing/ledger integration, Stripe | Planned four qualifying paid weekly bookings then fifth free, not current behavior. Coordinate merge and #115/#116; no completion claim. |
| Elite player/owner: squad matchmaking, proposals, waitlists/demand | `player/elite.tsx`, `(owner)/bookings.tsx` demand panel → `elite.ts`, recovery helper | S; #103 Merged; V0 | DB, Elite venue owner, notifications/payment | Locks/expiry/booking reuse exist; captain/member consent policy and concurrency still need launch proof. Archived #111/#112 are not mandates. |
| Elite venue/player: leaderboard and player breakdown | Venue detail's VenueLeaderboard component → `leaderboard.ts`, leaderboard helper | S; #104 Merged; V0 | DB, recorded eligible statistics, Elite venue | Public exposure and sample/tie behavior need product/privacy review. Downgrade/hidden/no-data behavior must be checked. |
| Elite owner: create/edit/publish/close/bracket/results/cancel tournaments | `(owner)/tournaments/index.tsx`, `new.tsx`, `edit.tsx`, `[id].tsx` → `tournaments.ts` | S; #102 Merged; V0 | DB, Elite entitlement, Stripe/refund provider | Single elimination only; prize pool is tracked, not escrow/payout. Concurrent lifecycle acceptance #113 outstanding. Plans label contradicts source. |
| Player: tournament discovery/player or team registration/payment/results | `(player)/tournaments/index.tsx`, `[id].tsx` → public/player tournament routes | S; #102 Merged; V0 | DB, native Stripe/Connect, tournament webhook | One registrant entry; pending seats consume capacity. Web checkout and refund recovery must be proven separately. |
| Admin: overview, venue inspection/approve/reject/disable | `(admin)/index.tsx`, `venues.tsx` → `admin.ts` | S; #40 Merged; V0 | DB, auth | Inspect actual detail/approval requirements; Archived suggestions for search/completeness are not guaranteed behavior. |
| Admin: users and subscription override | `(admin)/users.tsx` → `admin.ts`, `subscriptions.ts` | S; #37/#98 Merged; V0 | DB | Suspension/reinstatement is Draft #44, not delivered from Users-tab existence; volume/count checks #45/#46. |
| Admin: booking list/detail/refund/audit/export | `(admin)/bookings.tsx`, `admin/booking/[id].tsx` → `admin.ts`, `bookings.ts` | S; #39 Merged; V0 | DB, Stripe or mock refund | Force-refund bypasses ordinary window, not offline-payment rules. Inline history/export scope #47/#49 and complete audit coverage #48. |
| Admin: match-stat corrections and leaderboard source inspection | `admin/booking/[id].tsx` MatchStatsManager; `(admin)/users.tsx` AdminLeaderboardSources → `match-statistics.ts`, `leaderboard.ts` | S; #99/#104 Merged; V0 | DB, admin auth | Separate admin powers are not owner entitlement bypasses for ordinary users; prove edit/delete consistency, source visibility and audit history. |
| Player/owner: account edits, password and deletion | Role settings/profile components → `player-account.ts`, `owner-account.ts`, `auth.ts` | S; #82 Merged security baseline; V0 | DB, session checks | Account soft-deletion/session invalidation exists; retention and booking/financial/statistics cleanup policy must be agreed and tested, not inferred from a delete button. |
| Admin: global fee and venue waiver controls | `(admin)/index.tsx` → fee/settings routes in `payments.ts` | S; #2/#38 Merged; V0 | DB | Fee enable confirmations exist; global disabled state wins over a venue enable override. Verify persisted percentages and historical payment snapshots. |

## Domain rules and financial safeguards

### Availability, booking and cancellation

Booking status enum is `PENDING → CONFIRMED`; cancellation leads to `CANCELLED` or `REFUNDED` when a successful payment is refunded. `NO_SHOW` is also represented. Do not invent a `COMPLETED` booking status from a match record.

The availability engine intersects venue opening hours with pitch slot duration, removes maintenance and date/weekly availability blocks and occupied active slots, and requires an approved venue. Time boundaries in helpers use UTC (`...Z`, `getUTCDay`); review Cyprus local-time/DST display and policy before release. Overnight hours are not established by this inspection.

[Booking schema](lib/db/src/schema/bookings.ts) uses partial uniqueness `(pitch_id, start_at)` only for PENDING/CONFIRMED. Cancelled/refunded/no-show rows do not block that index. It is **not a general arbitrary-range exclusion constraint**. Fixed slots, validation, transactions and tournament schedule coordination matter. [Shared slot reservation](artifacts/api-server/src/lib/slot-booking.ts) uses serializable transactions and maps unique/serialization conflicts to slot taken. Ordinary booking routes and tournament guards are separate paths: prove all of them together, including simultaneous tournament publish and booking/block changes.

The booking policy snapshot captures cancellation window, slot duration and pricing data. Checkout currently reads current pitch pricing (first returned rule) for the subtotal; it is not a complete immutable quoted-price guarantee. A normal abandoned PENDING checkout is not proven to have automatic recovery equivalent to Elite's proposal expiry.

Players can cancel their own booking; owners can cancel bookings in their own venue and must provide a reason. Both ordinary online cancellation paths enforce the snapshot cancellation window (fallback 24 hours); admins use their force-refund endpoint instead. Manual bookings bypass the online-window/provider-refund path and are settled offline. Notifications and slot/waitlist follow-up must not convert a failed financial action into apparent success.

### Ordinary booking checkout, fee and Connect rules

Read [payments routes](artifacts/api-server/src/routes/payments.ts), [provider](artifacts/api-server/src/lib/payment-provider.ts), [settings schema](lib/db/src/schema/admin.ts) and [payment schema](lib/db/src/schema/payments.ts).

1. `POST /api/bookings` reserves a PENDING slot. Player-owned ONLINE bookings call `POST /api/bookings/:bookingId/checkout`.
2. FULL base is hourly price × slot duration / 60. DEPOSIT uses configured FIXED/PERCENT pricing rules; NONE/invalid configuration rejects deposit. Provider has a 30%-minimum-€1 fallback, but the current route validates/configures an override, so that fallback is not the product deposit policy.
3. Default admin percentage is 6.00. Global fee disabled or a venue override `false` waives it; venue `true` cannot override global disabled. Missing settings in the provider also waive the fee.
4. **Booking fee is added**, not deducted from the advertised booking base: fee = paid base × percentage rounded to two decimals; charged total = base + fee. Example: €100 full base → €6 fee → €106 charge. €30 deposit → €1.80 fee → €31.80 charge; waived → €30. These are code arithmetic examples, not settlement rehearsals. Float arithmetic/rounding boundary coverage remains #12.
5. Amount, percentage, waiver, currency and payment type are persisted per payment. Never recompute a past payment from today's admin settings.
6. No server Stripe key → mock intent; default mock success confirms immediately, `MOCK_PAYMENT_FAIL=true` simulates decline. Server Stripe key → real Stripe intent, HTTP 202/client action, then `/capture` checks provider status before marking payment/booking successful in a DB transaction.
7. Idempotency defaults to booking/type/user or uses caller key. Successful same-key replay returns existing state. Existing pending Stripe replay currently returns provider ID without a fresh `clientSecret`; failed/retry states can require a new key. Crash/reopen recovery and preventing multiple different-key successful intents on one booking need explicit tests. There is no ordinary-booking Stripe webhook route in the inspected payments file; do not assume tournament/subscription webhooks reconcile ordinary bookings.
8. Current Stripe intent uses `transfer_data.destination` if owner Connect ID exists; uses `application_fee_amount` for nonwaived fees. With an owner ID and waived fee it still transfers. Without an ID, it creates a platform charge; **this is not proof that the owner gets paid**. It does not fetch `charges_enabled`/`payouts_enabled` before intent creation. #13's Ready change overlaps this logic and #94 covers verification.

Owner Connect onboarding is in [owner-account routes](artifacts/api-server/src/routes/owner-account.ts). `APP_DOMAIN` supplies return/refresh URLs and otherwise defaults to an example host. Rehearse expired onboarding links, refresh/resume, disabled charges/payouts and account updates; #14/#15 remain Draft.

### Refund and reporting hazards

Ordinary player/owner cancellation and admin force-refund call the external provider **before** writing booking/payment/refund/audit changes in a transaction. DB consistency does not make provider+DB atomic. A provider refund can succeed while the DB commit fails. The generic refund call does not use a provider idempotency key, `reverse_transfer` or `refund_application_fee`; it treats pending provider refund as success. Free-text reasons may also reach Stripe's restricted reason field. Review and rehearse these paths, including repeated admin requests, before real money is accepted.

[Revenue helper](artifacts/api-server/src/lib/owner-analytics.ts) counts persisted SUCCEEDED/PARTIALLY_REFUNDED payment amount minus successful refunds and subtracts stored fees. It intentionally does **not** prorate fee amounts for partial refunds; completely REFUNDED payment rows are excluded. #10 is therefore a substantive accounting question, not proof that every refund case fails. Booking CSV uses snapshot booking revenue and source/status/offline marker, not the same collected-payment calculation. Deposits, fee waivers and refunds can yield different totals between views; reconcile them against a defined financial reporting policy (#10/#12/#109).

### Offline manual bookings

Pro/Elite capability `MANUAL_BOOKING` is server enforced on creation. Manual bookings store guest details and `source=MANUAL`, begin PENDING, and become CONFIRMED only when the owner marks offline receipt (`offlinePaymentReceivedAt`). Provider checkout/capture and admin provider refund reject manual bookings. No provider fee is levied. Repeated receipt marking must not duplicate effects; plan downgrade behavior for already-created bookings needs acceptance testing. Offline cash/card reversal and receipts are owner operations, not Stripe refunds (#108/#109).

### Subscriptions and entitlements

Read [subscription routes](artifacts/api-server/src/routes/subscriptions.ts), [entitlements](artifacts/api-server/src/lib/entitlements.ts), [subscription schema](lib/db/src/schema/subscriptions.ts).

| Effective plan | Current server capabilities |
|---|---|
| FREE | Core booking/venue management; empty premium-capability list |
| PRO | MANUAL_BOOKING, ADVANCED_ANALYTICS, MATCH_STATISTICS |
| ELITE | All Pro capabilities plus ELITE_MATCHMAKING, TOURNAMENT_CREATOR |

Capabilities belong to the **venue owner**, not a paid player membership. Elite discovery/features resolve the venue owner's effective plan. A currently active admin override takes precedence. ACTIVE with unexpired/no recorded end grants the recorded plan; PAST_DUE or CANCELED retains it only until a future paid period end; otherwise FREE. Cancellation at period end is distinct from immediate loss of access. Do not bypass server gating by trusting plan cards.

Premium discovery metadata labels Pro/Elite venues as “Verified Pro”/“Verified Elite” and applies a bounded ranking boost (one/two positions from a stable name/ID baseline). This is subscription-derived metadata, not independent certification of venue quality or payment readiness; confirm the wording with the product owner.

Billing requires both price IDs, server key and subscription webhook secret; otherwise checkout returns unavailable (no fake recurring purchase). A conditional checkout-creation lease and provider idempotency protect concurrent attempts. Existing open same-plan sessions can be reused; provider subscription/session reconciliation prevents blindly issuing a new checkout after delayed webhook/expired local lease. Existing subscriptions are managed via billing portal/cancel route. Provider events are deduped and ordered by provider timestamp/ID cursor. The signed raw-body endpoint is `/api/webhooks/stripe/subscriptions`; it processes `customer.subscription.*`. Browser success navigation alone does not grant entitlement.

Rehearse duplicate/delayed/out-of-order webhooks, missing owner mapping, failure between provider session creation and DB update, grace period expiry, overrides and downgrade for existing records. Display prices are not authoritative invoices; decide and configure Stripe products/currency/tax policy with the product owner.

### Notification and SMS lifecycle

In-app notification rows can be immediate/scheduled and use dedupe keys. Push helper records Expo tickets, polls receipts and clears DeviceNotRegistered tokens; failure is nonfatal to primary booking operations. The push dispatcher sends due reminders and match-finished notices. “Best effort” is not a delivery guarantee or an exactly-once multi-instance promise; rehearse duplicates/process death and badge refresh.

SMS for Pro/Elite confirmed bookings schedules **24 hours before start**, only when that time is still future and a valid E.164 recipient exists. Guest phone is used for manual bookings; otherwise recipient account phone. Booking confirmation/edit/cancel triggers reconciliation. Sending rechecks active booking, recipient, future event and entitlement rather than trusting queued state.

SMS jobs: `SCHEDULED → PROCESSING → SENT`, or `RETRY`, `FAILED`, `CANCELLED`. PostgreSQL `FOR UPDATE SKIP LOCKED` claims jobs with a 60-second lease; expired PROCESSING work is reclaimable. Default max attempts and cost units are four. Retry delay starts at 30 seconds with exponential backoff capped at 15 minutes; event-time validation is separate from retry due time, so changing `scheduled_at` for a retry must not invalidate the original booking reminder.

The HTTP SMS adapter requires URL/token/from and sends JSON `{from,to,body}` with bearer authorization and an idempotency header. Successful HTTP response may supply a message ID; it does **not** prove handset delivery. Timeout/network/408/429/5xx are retryable, other errors terminal. Missing configuration disables the provider and cancels attempted jobs, rather than pretending to send. Provider support for idempotency and cost accounting must be confirmed (#106). Consent/opt-out UX is Draft #107; do not silently enable unsolicited SMS.

### Elite matchmaking and waitlists

[Elite service](artifacts/api-server/src/lib/elite.ts) checks approved Elite venues. Squad requests carry members/skill ranges/availability; compatible non-overlapping squads can reserve a standard PENDING booking and create a 30-minute proposal. Captains respond; payment remains ordinary booking payment, not a new provider system. Mutation limits use shared DB buckets.

Waitlist entries and claims respond to released slots with guarded claims/reservations. Recovery expires requests/proposals and releases/reoffers relevant slots every 30 seconds. Prove accepted/rejected/expired proposals, simultaneous claimers, no duplicate participants, plan downgrade and ordinary booking conflicts. Member participation/consent and whether names/statistics are public remain product/privacy decisions, not inferred requirements from Archived suggestions.

### Tournaments

Read [tournament routes](artifacts/api-server/src/routes/tournaments.ts), [schema](lib/db/src/schema/tournaments.ts), [bracket helper](artifacts/api-server/src/lib/tournament-domain.ts).

- Owner management requires Elite and ownership. Lifecycle: DRAFT → PUBLISHED → REGISTRATION_CLOSED → IN_PROGRESS → COMPLETED; cancellation moves to CANCELLED. Draft deletion is distinct from cancelling published records.
- Current format is SINGLE_ELIMINATION, entry is PLAYER or TEAM. A team entry records a captain/team name, not a proven teammate invitation/consent or full roster product. Dates/deadline and EUR monetary fields are validated; current capacity is an integer from 2 to 256, end must follow start and deadline must precede start.
- Publish/edit/match schedule checks use hours, maintenance, blocks, active bookings and tournament conflicts with pitch advisory locks. Verify ordinary booking routes coordinate every conflicting path; guards are not a universal DB range-exclusion proof.
- Registration uses tournament advisory lock plus uniqueness per tournament/registrant. PAYMENT_PENDING and CONFIRMED reserve capacity. Deadline/duplicates/full conditions reject; a failed or abandoned registration's retry/release policy must be tested, not assumed to expire automatically.
- Entry price/currency/prize contribution are snapshots. Paid intents use a separate tournament payment ledger with idempotency and an active-attempt constraint. Zero entry price or missing Stripe key uses mock mode.
- **Unlike ordinary bookings, tournament fee is taken from the entry amount**, not added to the player's total. Connect receives the destination charge with the configured enabled percentage as application fee. The paid-Stripe checkout route rejects a missing owner Connect ID (`OWNER_ONBOARDING_REQUIRED`), unlike ordinary checkout's platform-charge fallback; it still does not establish that charges/payouts are enabled. The intent helper has a platform-charge fallback, but the route guard normally prevents reaching it without an account. Prize contribution snapshot currently starts as the entry fee, not verified net-after-fee escrow.
- Client capture and signed `/api/webhooks/stripe/tournaments` reconcile success/failure. Confirmation requires PUBLISHED and no generated bracket; a late successful payment after an ineligible lifecycle is put into REFUND_PENDING rather than admitted. Do not assume closing registration then capturing is valid.
- Bracket generation locks tournament/rows, takes confirmed registrations, requires at least two, rounds size up to a power of two and distributes first-round byes. Results advance winners and complete the final. Corrections after advancement and concurrent submissions require tests.
- Cancellation marks matches/registrations and successful payments for refund, attempts provider cancellation/refund, and retains failures for owner `/refunds/retry`. Tournament refunds use stable provider idempotency with transfer/application-fee reversal—different from ordinary booking refunds.
- Configured prize pool, collected totals and registration contributions are tracking, not automated payout, tax reporting, legal escrow or a guarantee the advertised prize is funded. Assign responsibility for prizes and legal review.

#113's concurrency tests remain outstanding. The existing small pure-domain and schema-validation tests cannot prove capacity, webhook/capture races, refund recovery or schedule exclusion against PostgreSQL and Stripe.

## Configuration reference

Names only; retrieve values through the team-approved secrets manager. **Server variables never belong in `EXPO_PUBLIC_*`, client bundles, commits or screenshots.** Configuration presence in the workspace is not production configuration or provider readiness.

| Variable | Scope / requiredness | Purpose and caution |
|---|---|---|
| `DATABASE_URL` | Server/tools; required | Private PostgreSQL connection. DB module/config refuse missing value. Use dedicated disposable DB for setup rehearsal. |
| `TEST_DATABASE_URL` | Tests; required for integration wrappers | Separate disposable database; wrappers migrate and suites write/delete fixture data. Must not alias development/production. |
| `JWT_SECRET` | Server; required | Long random signing secret; API refuses startup without it. Rotation invalidates signed sessions. |
| `SESSION_SECRET` | Server; optional but coordinate | Preferred rate-limit HMAC source in auth; JWT fallback; photo-token helpers also use signing secrets. Not a separate browser-session auth solution. |
| `PORT` | Runtime server/client | API requires numeric positive value; workflows assign ports. Expo launcher default 20728. |
| `NODE_ENV` | Server/build | `dev` script forces development; production must set production. Controls log formatting and reset URL fallback; test email outbox is test-only. |
| `LOG_LEVEL` | Server; optional | Pino level, default info; retain redaction. |
| `DEMO_SEED_PASSWORD` | Seed only; required for seed | Unique demo password meeting new-password policy. Do not carry into release environment. |
| `STRIPE_TEST_SK` | Server; optional for isolated demo, necessary for real Stripe | Selects Stripe provider whenever present. Despite legacy name, review mode/account/version explicitly; no separate live-key setting is defined here. |
| `STRIPE_TEST_PK` | Server response / publishable to client | Stripe publishable key returned to native checkout; must match server mode/account. Not a secret signing key. |
| `MOCK_PAYMENT_FAIL` | Server; isolated development only | `true` simulates ordinary mock decline; not a production fallback plan. |
| `APP_DOMAIN` | Server; required before real billing/Connect | Approved HTTPS public origin for Connect and recurring checkout/portal redirects. Defaults to an example host if omitted. No production URL was discovered/assumed for this handoff. |
| `STRIPE_SUBSCRIPTION_PRO_PRICE_ID` | Server; required for recurring billing | Provider product/price for Pro. |
| `STRIPE_SUBSCRIPTION_ELITE_PRICE_ID` | Server; required for recurring billing | Provider product/price for Elite. |
| `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET` | Server; recurring billing | Endpoint signing secret for subscription webhook. |
| `STRIPE_TOURNAMENT_WEBHOOK_SECRET` | Server; paid tournaments | Endpoint signing secret for tournament payment webhook. |
| `PASSWORD_RESET_WEB_URL` | Server; required in production | HTTPS reset-password page, no credential/query/fragment; must end `/reset-password`. Dev can derive from development domain. |
| `PASSWORD_RESET_FROM_EMAIL` | Server; required for email delivery | Verified sender identity; use actual service-owned sender privately. Existing configuration must not be copied as access evidence. |
| `PASSWORD_RESET_APP_URL` | Server; optional | Valid `versafutsalapp` reset deep link; validate on installed builds. |
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | Server; venue photos | Replit storage bucket selection; successful config is not proof of access/durable lifecycle. |
| `SMS_PROVIDER_URL` | Server; optional until SMS launch | Chosen HTTP gateway endpoint; do not put credentials in URL. |
| `SMS_PROVIDER_TOKEN` | Server secret; SMS | Bearer credential for gateway. |
| `SMS_PROVIDER_FROM` | Server; SMS | Approved sender. |
| `SMS_PROVIDER_NAME` | Server; optional | Log/provider label, default `http`. |
| `SMS_TIMEOUT_MS` | Server; optional | Adapter clamps 500–15000 ms, default 5000. |
| `EXPO_PUBLIC_DOMAIN` | Public compiled client/build | Native API hostname, no scheme; web uses browser-derived host. Launcher overwrites local dev setting. |
| `EXPO_PUBLIC_REPL_ID` | Public compiled build | Replit identity used in build/manifest plumbing, not authentication. |
| `REPLIT_DEV_DOMAIN`, `REPLIT_DOMAINS` | Replit development metadata | Used by dev launcher and some URL builders; not reliable production origins. |
| `REPL_ID` | Replit metadata | Launcher/build public ID input. |
| `REPLIT_INTERNAL_APP_DOMAIN` | Build metadata | Static builder's preferred deployment hostname input; do not infer production URL from it for callbacks. |
| `EXPO_PACKAGER_PROXY_URL` | Metro development | Temporary advertised packager host; launcher supplies it. |
| `BASE_PATH` | Artifact/build/serve | Path routing prefix; canvas `/__mockup`, Expo `/`. Review client/API URLs when changing mounts. |

`PRIVATE_OBJECT_DIR` and `PUBLIC_OBJECT_SEARCH_PATHS` exist in the environment inventory but were not found as active Versa source dependencies; do not invent required values. Resend connector authorization is managed by Replit's connector SDK, not a `RESEND_API_KEY` variable in the inspected email helper. Do not invent environment entries merely because a generic provider tutorial uses them.

## Quality and security

### Available commands and test inventory

Commands below are verified as scripts in [API package](artifacts/api-server/package.json), [client package](artifacts/futsalcy/package.json) and root/DB/spec packages; **they were not executed**. There is no root `test` script or demonstrated unified CI gate.

| Exact command | Coverage / limitation |
|---|---|
| `pnpm run typecheck:libs` | TypeScript build-mode shared library references |
| `pnpm run typecheck` | Libraries then artifact/scripts typechecks; historic blockers #11/#74 must be revalidated |
| `pnpm run build` | Typecheck then recursive package builds; includes Expo static build caveats |
| `pnpm --filter @workspace/api-server run build` | esbuild ESM `dist/index.mjs`; not itself a typecheck |
| `pnpm --filter @workspace/api-server run start` | Starts built bundle; requires DB/JWT/PORT |
| `pnpm --filter @workspace/futsalcy run build` | Custom static native-manifest/bundle capture, Metro 8081 assumption |
| `pnpm --filter @workspace/futsalcy run serve` | Custom static-build/landing server; not proof of production routed web forms |
| `pnpm --filter @workspace/api-server run test:security` | Handwritten request/input/password policy regressions |
| `pnpm --filter @workspace/api-server run test:image-upload-validation` | Byte-signature/decode/dimension validation |
| `pnpm --filter @workspace/api-server run test:login-rate-limit` | Limiter policy/unit tests |
| `pnpm --filter @workspace/api-server run test:entitlements` | Effective plan/capability/event-cursor and webhook-related helper tests |
| `pnpm --filter @workspace/api-server run test:match-statistics` | Match-stat validation/domain consistency |
| `pnpm --filter @workspace/api-server run test:leaderboard-query` | Leaderboard query/helper logic |
| `pnpm --filter @workspace/api-server run test:sms-reminders` | Reminder schedule, lease/retry/budget helper behavior, not handset delivery |
| `pnpm --filter @workspace/api-server run test:analytics-discovery` | Premium analytics/discovery definitions |
| `pnpm --filter @workspace/api-server run test:manual-bookings` | Source/offline/revenue helper rules |
| `pnpm --filter @workspace/api-server run test:elite-validation` | Elite input/range/slot helper validation |
| `pnpm --filter @workspace/api-server run test:tournaments` | Bracket/byes and confirmation helper tests |
| `pnpm --filter @workspace/api-server run test:tournament-secure` | Small tournament request-schema tests; no live concurrency/provider coverage |

The following are **database-mutating integration scripts**. Set `TEST_DATABASE_URL` privately to a dedicated disposable DB. Their package wrappers substitute it for `DATABASE_URL` and run migrations before the suite:

```bash
pnpm --filter @workspace/api-server run test:unique-phone
pnpm --filter @workspace/api-server run test:session-revocation
pnpm --filter @workspace/api-server run test:password-reset
pnpm --filter @workspace/api-server run test:match-statistics:integration
pnpm --filter @workspace/api-server run test:leaderboard:integration
pnpm --filter @workspace/api-server run test:manual-bookings:integration
```

Password-reset integration uses NODE_ENV=test and a test outbox, not Resend delivery. Review fixture cleanup and test auth secrets before running each file. A failing migration may prevent the suite from exercising features at all; record provisioning separately from test results.

**Special danger:** `test:login-rate-limit:db` does not have the `TEST_DATABASE_URL` wrapper and uses the normal DB module. It deletes/writes fixture rate-limit rows. Invoke only with explicit disposable substitution:

```bash
# TEST_DATABASE_URL must already point to an isolated disposable DB.
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @workspace/api-server run test:login-rate-limit:db
```

Unit/helper scripts that provide an `unused` database URL do so for module import, not as a real database setup. New tests should fail closed on missing disposable configuration rather than default to shared data. No browser or physical-device regression suite was run here; no current security-audit pass is claimed.

### Implemented security boundary versus launch proof

- [Security policy](SECURITY.md): API edge validation, bounded JSON 100kb/urlencoded 32kb, strict params/body/query shapes, Unicode-safe plain-text normalization, parameterized Drizzle queries and escaped UI output. Generated types alone are not protection. Request/body validation also runs in customFetch.
- Passwords are never trimmed/normalized; policy 8–256 characters with common-password denylist, 12+ recommended, versioned SHA-256 prehash then bcrypt cost 12; legacy direct-bcrypt verification remains.
- Auth is email/password bearer JWT, **not Clerk or Replit SSO**. JWT lifetime is 30 days. Middleware checks account deletion and matching integer session version in DB. Credential reset/change revokes old sessions. Client logout removes local tokens; do not assume it revokes a stolen token server-side.
- Recovery tokens are hashed, expiring (30 minutes) and single-use; generic request response avoids account enumeration. Email configuration/delivery failures require operational alerts because the user-facing response intentionally remains generic.
- Login limit is ten attempts per 15-minute fixed window for both normalized account and socket peer address. HMAC digests, not raw identifiers, are persisted with atomic upsert. It intentionally ignores forwarded headers; a proxy can collapse many users to one socket peer unless trusted edge/address design is reviewed. Additional endpoint abuse controls need risk-based review.
- [Image validation](artifacts/api-server/src/lib/image-upload-validation.ts): avatar 8 MiB, venue 5 MiB, JPEG/PNG/WebP, extension/signature/decoder checks, max 8000×8000 and 24 million input pixels, re-encoded WebP. Uploaded MIME declaration is untrusted. Multipart ownership/params are checked; request-level and authorization tests remain #85/#88.
- [Structured logger](artifacts/api-server/src/lib/logger.ts) redacts sensitive fields; HTTP serializer omits request query strings/body. Some route helpers still use console logging; audit provider errors and identifiers before release. Never log reset tokens, bearer headers, raw personal payloads or credential URLs.
- Venue photos use private object storage/API read routes; validate ownership/access, public approved-photo behavior, delete/cover ordering and URL token expiry. Avatars use public local `/api/uploads`; hosting durability/access policy is an unresolved release risk.
- [Security exceptions](security-audit-exceptions.md) records two high-severity `image-size` development/build parser advisories with no patched release reported **at the time of that note**. #90 is Merged dependency remediation, not a fresh clean audit. Rerun current dependency/security review, validate overrides stay within Expo compatibility and reassess the exception; do not claim zero vulnerabilities.

## Operations, release and portability

### Deployment configuration is not deployed-state evidence

[.replit](.replit) declares application router/autoscale and a post-build `pnpm store prune`. Artifact manifests define the intended production commands:

| Manifest | Production build | Production run / startup health |
|---|---|---|
| [API artifact](artifacts/api-server/.replit-artifact/artifact.toml) | `pnpm --filter @workspace/api-server run build` with production NODE_ENV | `node --enable-source-maps artifacts/api-server/dist/index.mjs`, PORT 8080/NODE_ENV production; `/api/healthz` |
| [Mobile artifact](artifacts/futsalcy/.replit-artifact/artifact.toml) | `pnpm --filter @workspace/futsalcy run build` | `pnpm --filter @workspace/futsalcy run serve`, PORT 20728/BASE_PATH `/` |

These declarations and the [static server](artifacts/futsalcy/server/serve.js) do not establish a published URL, schema readiness, functioning web deep routes, native signing or a healthy production deployment. API build does not typecheck; retain a separate release gate. The production direct Node command runs from repository root whereas development runs in the API artifact, so `process.cwd()/uploads` also differs; do not rely on local avatar files surviving that transition. No production URL, provider account or database was queried for this handoff. Retrieve approved public URLs from the actual publishing configuration and domain owner, not a development environment variable.

Replit's [deployment types documentation](https://docs.replit.com/features/publishing/deployment-types) describes Autoscale scaling to zero when idle, Reserved VM for continuously running services and Scheduled deployment for periodic commands. Current reminders/recovery use timers **inside the API process**. With autoscale they may stop while idle; multiple replicas also need deduplication/lease coverage for each job type. Decide on an always-running worker or external durable scheduler, document ownership and prove idle/restart/overlap behavior before promising reminder timing. Do not fix this merely by adding a keepalive URL.

Release preparation must define separate commands/routing for API, web/reset-password pages and native delivery. Verify `/api` is mounted exactly once through the proxy; forwarded headers, callback origins, HTTPS, CORS allowlist and static upload paths need review. API dev builds then starts without watching; production should use reviewed build/start commands and production environment.

### Provider and operational rehearsals

| System | Release proof and operating responsibility |
|---|---|
| Stripe ordinary booking/Connect | Approved test rehearsal for full/deposit/waiver, decline/3DS, app close/reopen, missing/not-ready Connect, destination transfer/application fee, cancellation/admin refunds, reconciliation after provider success + DB failure. Then approved live configuration/mode review; no paid live rehearsal without explicit authorization. |
| Stripe subscriptions | Configure both real prices, portal, approved return URLs, signed subscription webhook and owner mapping; rehearse renewal/cancellation/grace/override and delayed/duplicate events. |
| Stripe tournaments | Configure separate signing secret and endpoint; rehearse simultaneous checkout/capture/webhooks, late successes, cancellation/refund retry and ledger/prize totals. |
| Resend | Confirm connector authorization, sender/domain verification, delivery/bounce monitoring, reset page/deep links and ownership transfer. Generic API success is not an email receipt. |
| Expo Push | Signing/APNs/FCM/project setup and permission flows on actual iOS/Android builds; validate background/resume/denial, receipt cleanup and notification destination. No Android Expo Go/web claim. |
| SMS | Select/approve gateway protocol, idempotency behavior, sender, approved test recipients, cost caps, delivery receipts and consent/opt-out. Disabled-mode unit tests are not delivery proof. |
| Venue storage/avatars | Prove upload/read/delete across restarts/releases and access restrictions; establish durable avatar strategy and cleanup/backups. A bucket's existence is not an access test. |
| PostgreSQL | Reviewed migrations, least privilege, backup retention, point-in-time/restore capability, rehearsed recovery and schema rollback/forward-repair plan. Assign owner and recovery objectives. |

Monitor API error rate/latency and DB pool/health, webhook verification failures/unmapped events, provider-to-ledger divergence, overdue jobs/expired leases, refund-pending age, undelivered push/reset messages, upload failures and storage growth. Existing Pino/health code is not a complete dashboard/alerting/on-call plan. Set thresholds, escalation contacts and runbooks without putting private contacts in this shareable document.

Use [Replit data-recovery documentation](https://docs.replit.com/features/data-and-storage/data-recovery) for platform recovery options and verify your actual plan/retention. Development checkpoints are not a substitute for a rehearsed production restore. Define acceptable data loss/recovery time with the owner, preserve financial audit history and validate restores into isolation before cutover.

### Portability outside Replit

PostgreSQL/Drizzle, Express, OpenAPI/React Query and Expo are portable foundations. Replit-specific parts needing deliberate replacement/configuration:

- `.replit` workflows, path/Expo-domain proxy, environment metadata and generated artifact services.
- Resend transport via `@replit/connectors-sdk`; use a supported provider credential/transport off-platform without leaking it into the client.
- Venue photos via `@replit/object-storage` and bucket selection; provide compatible persistent storage/access policy and migrate references safely.
- Cloudflare development tunnel launcher, compiled native API hostname and web hostname derivation.
- Static Expo manifest hosting assumptions/landing page and application-domain routing.
- Post-merge database push automation; replace with approved CI/migration/release procedures rather than silently pushing production.
- Linux-specific dependency exclusions and native build/signing infrastructure.

Do not export actual secrets or production data as part of “porting”. Use new least-privilege access, approved data migration and validated file lifecycle/recovery.

## Prioritized completion roadmap

This is a proposed sequencing guide, **not a commitment that every Draft is required for MVP**, and not a delivery date/budget. Each gate must be scoped to the owner's approved release platforms and premium feature availability. Start by revalidating source/board after merges.

| Priority / category | Work and why | Start here / prerequisites | Objective acceptance |
|---|---|---|---|
| P0 setup/reliability | Clean migration bootstrap (#110): new installations/tests cannot rely on pushed schema | Journal, guest/manual/match/tournament migrations, prerequisite helper; disposable empty DB + representative isolated copy | Full chain creates all schema/constraints; repeat reviewed setup without prompts/data loss; clean-bootstrap CI independent of feature fixtures |
| P0 verification | Restore trustworthy checks (#11/#74): build cannot be a gate if known baseline fails | Root/client/API scripts, generated client; frozen dependencies; reproduce current errors first | `pnpm run typecheck` and agreed release build pass on clean checkout; failures are blocking and outputs retained; retire stale Draft claims rather than duplicating fixes |
| P0 financial | Booking fee/refund/Connect safety (#10/#12/#13/#94): wrong ledger/payout can lose money | Provider/payments/analytics/admin; reconcile Ready #13; Stripe test mode + owner test Connect + disposable DB | Full/deposit/waiver/rounding/different-key retry/late capture tested; one charge/confirmation; owner readiness policy enforced; refunds/fee/transfer and UI/export totals reconcile; recovery after interrupted DB/provider action documented |
| P0 financial | Subscription recovery: prevent duplicate billing or wrong access | Subscription routes/events/entitlements; recurring prices, webhook test endpoint, isolated owner | Duplicate/concurrent checkout and delayed/out-of-order events yield one subscription; override/grace/expiry/downgrade proven; restart recovery does not require manual DB edit |
| P0 if tournaments ship | Tournament concurrency (#113): capacity/payment/bracket safety | Tournament routes/migrations; TEST_DATABASE_URL + Stripe test configuration | Parallel last-seat/duplicate registration tests, one active payment, capture+webhook race, late success refund, idempotent refunds, safe schedule conflicts and prize-ledger totals |
| P0 security/operations | Durable avatars and release access policy (#118): local files can be lost | Avatar route/app static uploads; approved storage and data-retention policy | Avatar survives deploy/restart/replica; unauthorized access/upload rejected; existing references migrated without broken profiles |
| P0 operations | Background jobs (#117): current autoscale/timers do not guarantee timing | API startup, notifications/SMS/Elite helpers; chosen worker model | Idle/restart/multi-instance rehearsal sends no duplicate charge, recovers due leases and expires proposals; alerts identify overdue work |
| P1 release configuration | Live Stripe/Connect/recurring/tournament settings and approved origins | Provider table, APP_DOMAIN, signed webhooks; business owner/account approvals | Matching modes/accounts, verified webhook signatures and redirects, missing config fails safely, no mock in live money flows |
| P1 if SMS ships | Delivery and consent (#106/#107): code is not a carrier integration or permission | SMS adapter/jobs; chosen provider, consent policy, approved recipients | One approved reminder delivered; reschedule/cancel/retry cost/duplicate behavior proven; opt-out honored; delivery/error monitoring and budget owner assigned |
| P1 release configuration | Physical-device push (#30/#32/#56), reset email, storage rehearsal (#85/#88) | Native development builds, push hook/receipts; sender/storage authorization | iOS/Android background/resume/denial verified, badges resync, recipient isolation enforced; reset single-use link arrives/works; image lifecycle/security regression passes |
| P1 merge/verification | Forms (#96/#97): motion must not block controls | Reconcile Ready branch; shared Motion/keyboard/profile/onboarding/admin forms | Focus/edit/submit/reason/switch/selector/modal behavior passes native+web and reduced-motion checks with no duplicate action |
| P1 feature integration | Growth tools (#100/#115/#116): discounts/rewards change financial rules | Coordinate separate Active/Ready work, immutable pricing/redemption schema and task plan; no parallel rewrite | Entitlement/usage/expiry/concurrency limits, fifth reward/reversal and zero-cost checkout proven; fees use discounted paid base; device Stripe recovery; owner analytics scope agreed |
| P1 product accuracy | Plan-copy alignment and pricing: customers should not buy misleading capabilities | Plans screen vs entitlement/routes; owner chooses launch availability/prices | Labels/upgrade paths match released and verified functionality; web/device exclusions disclosed; Stripe prices agree with approved copy |
| P1 owner decisions | Platforms, privacy/prizes/retention/refunds: implementation cannot decide these | Readiness decision table; legal/privacy review and operating owner | Written platform/scope/fee/refund/prize/consent/retention decisions; appropriate terms and release sign-off |
| P2 feature/UX | Owner editing/onboarding/recovery (#6/#7/#9/#14/#15/#20–#23), cancellation/badge UX (#31), offline receipts/reconciliation (#108/#109) | Corresponding client/server flows; reproduce before accepting Draft work | Crash/background/expired-link recovery preserves valid data, users see approval/cancellation next steps, receipt and period totals match defined offline policy |
| P2 admin/control | Suspension/user volume/count (#44–#46), audit coverage/inline history/export (#47–#49) | Admin/users/audit helpers; agreed retention/admin-power policy | Authorized reversible moderation, fresh pagination/counts, every status mutation has scoped audit record, exports honor owner/privacy policy |
| P2 targeted regression | Avatar/session/phone/photo/default/heart checks (#34–#36/#59/#79/#85/#86/#88), notification completion/search (#55/#57/#58) | Source-present UI/tests; decide future group booking/completion scope | Reproduce first; close overlapping tests only after request-level/device assertions. Conditional future features remain optional until approved |
| P3 optional enhancements | Full-screen photos and slow-network carousel (#63/#64), reward analytics depth (#115) | Approved feature scope, images/performance or growth models | User can view/dismiss images accessibly with bounded memory/network; incentive dashboard uses defined attribution, not unexplained conversion claims |

Archived items in the appendix can inform risk review but are not automatic requirements or proof of missing behavior. Existing source sometimes already addresses a Draft partially (refund reporting, cancellation notifications, photo validation). Revalidate and consolidate with its owner rather than implementing from a stale title.

## First-week transition and smoke scenarios

These are sequencing suggestions, not a promise of one-week completion.

1. **Baseline/access:** record revision; refresh Merged/Active/Ready/Draft work; identify product/release owner; get least-privilege service access. Confirm approved platforms and premium launch scope.
2. **Setup/checks:** provision disposable PostgreSQL, resolve/rehearse clean migration setup, install frozen dependencies, reproduce current typecheck/build results. Record blockers rather than pushing a shared DB.
3. **Role walkthrough:** seed isolated demo, approve a venue, run the three role scenarios below without real messages/payments. Reconcile actual screens/API data and missing plan copy.
4. **Financial/provider rehearsal:** once schema/checks are sound and access approved, use test-only providers/recipients; reconcile #13/#96 and coordinate growth work. Exercise paid/refunded/subscription/tournament lifecycles including failure/retry.
5. **Operations/transition:** choose worker/hosting model, define monitoring/restore/on-call, prepare signed native builds and release checklist; agree acceptance ownership and remaining feature scope.

### Role-based smoke acceptance

| Scenario | Steps and expected outcome |
|---|---|
| Player core | Register with valid unique phone/password; login; filter venue, favourite/unfavourite, inspect photos/slots; book one valid slot and reject same-slot competition; full/deposit/waiver checkout with one confirmation; view/search history; cancel eligible booking and verify refund/audit. Another player cannot read/change it. |
| Owner core | New owner lands in setup; create venue/pitch/hours/pricing/photos; pending venue not publicly bookable; admin approval exposes valid slots; edits/blocks/maintenance change availability without corrupting existing bookings; calendar/detail/search/stats show owned data only; cancel with reason and correct policy. |
| Pro/Elite | Free creation of premium action gets entitlement error; active Pro manual guest booking stays pending until offline receipt, never enters Stripe; record/correct match statistics and view analytics with enough/insufficient samples. Override/period expiry/downgrade cannot create unauthorized new work. |
| Elite matchmaking | Submit compatible squads and waitlist entries; proposal reserves one slot; reject/expire/claim races release/reserve consistently; ordinary checkout confirms only once. Check notifications and no duplicate membership/claims. |
| Tournaments | Elite draft → publish; Pro/Free blocked; player/team register before deadline within capacity; duplicate/full rejected; free/test-paid entries confirm correctly; generate byes/bracket, schedule and advance results; cancel/retry refunds; late payment not admitted after closed/bracket/cancel state. |
| Admin | Inspect full venue before approve/reject/disable; list users/bookings; configure global percentage and per-venue waiver with confirmation; inspect scoped activity; force-refund online booking only; audit and financial totals match. Do not assume Draft suspension is available. |
| Device and recovery | Signed iOS/Android builds, background/resume/permissions/invalid session upgrade; checkout interrupted by app close/network loss; reduced-motion keyboard/modal forms; reset email/deep link and push routes. Web gets separate support expectations, not native checkout assumptions. |

## Readiness and access-transfer checklists

### Completion and launch gates

- [ ] Document's revision/task statuses refreshed after the last relevant merge; Ready work is not accidentally represented as deployed.
- [ ] Clean dependencies, library/API/Expo typechecks and agreed release builds pass; configured CI blocks regressions.
- [ ] Empty and existing-schema disposable migration rehearsals pass; constraints/order verified, no shared DB bootstrap workaround.
- [ ] Role authorization, unique phone, password/reset/session, uploads and cross-user notification tests pass.
- [ ] Ordinary payment/deposit/fee/waiver/Connect/cancellation/admin-refund and interruption recovery reconcile against provider and ledger; defined financial exports agree.
- [ ] Recurring checkout/webhook recovery, renewal/grace/cancel/override/downgrade pass; plan card copy/prices reflect what is actually released.
- [ ] Tournament last-seat/payment/webhook/bracket/cancel/refund concurrency covered if tournaments ship; no implied escrow/prize payout.
- [ ] Incentive concurrency/zero-cost/redemption/reversal recovery checked after growth merge if incentives ship.
- [ ] Each of iOS, Android and web has a written support scope. Unsupported web native payments are excluded honestly or implemented and tested.
- [ ] Physical-device signed builds prove Stripe, push/background/resume, keyboard/motion, deep links and media/location permissions; Expo Go alone is insufficient.
- [ ] Reset email, object storage and (if shipped) consented SMS delivered/rehearsed through approved test recipients/configuration.
- [ ] Worker model proves idle/restart/concurrency/lease recovery; monitoring and alert/runbook owner assigned.
- [ ] Production API/client/reset-page routes, domains/HTTPS, webhook URLs, CORS/trusted-proxy/IP limiting and secret handling reviewed.
- [ ] Durable avatars/files and cleanup/access policy established; backup/restore rehearsed with agreed retention and recovery objectives.
- [ ] Current dependency/static/security review and exception reassessment performed; findings disposition documented.
- [ ] Privacy/terms/retention/account deletion/statistics and tournament-prize review completed by responsible people; no legal conclusion inferred from this document.
- [ ] Native signing, Apple/Google accounts, merchant/payment permissions, store privacy declarations and release/rollback procedure owned and tested.
- [ ] Named release approver, operational maintainer, financial reconciliation owner and support/escalation process accepted handoff.

### Unresolved owner decisions

| Decision | Why it cannot be inferred from source |
|---|---|
| iOS/Android/web launch scope and geography | Expo can render multiple platforms, but native payment/push are not web equivalents. Cyprus context does not establish an expansion plan. |
| Live Stripe mode, Connect onboarding requirement and missing-account behavior | Legacy test-key names and optional destination routing do not establish live approval or an acceptable payout fallback. |
| Paid-plan prices, features and downgrade treatment | UI copy conflicts with source; invoice/tax/pricing policy is external configuration/business policy. |
| SMS provider, consent/opt-out, cost owner and acceptable timing | Adapter is generic/disabled without config; account phone is not by itself consent. |
| Cancellation/refund/application-fee/transfer and revenue definitions | Current reporting/refund paths differ; product/finance must define expected outcomes. |
| Prize funding, payouts, participant consent/public leaderboard exposure | Tracking schemas do not establish escrow, payout or legal/privacy authorization. |
| Domain ownership, callbacks and release credentials | No production origin/account details were retrieved or promised. |
| Retention/deletion/backup objectives and support/on-call | Account soft deletion and DB relations do not define a complete data governance policy. |
| Language/localization and later enhancements | Greek localization is Archived, not approved current release scope; future group booking/search is conditional. |

### Access transfer (service/account names only)

- [ ] Repository and issue/task-board access; identify branch/merge/release permissions and where review evidence lives.
- [ ] Replit workspace/artifacts/publishing and secrets-management access; distinguish development from production.
- [ ] PostgreSQL administration, migration approval and backup/restore access with least privilege.
- [ ] Stripe platform/Connect, recurring products/prices, billing portal and webhook management.
- [ ] Resend connector, verified sender/domain and bounce/delivery monitoring.
- [ ] Expo/EAS and Apple Developer/App Store Connect plus Google Play/FCM/APNs responsibilities as applicable.
- [ ] Replit object storage (or approved replacement) and any durable avatar/file service.
- [ ] SMS provider only after selection/consent approval.
- [ ] Domain/DNS/TLS administration and approved redirect/reset origins.
- [ ] Monitoring/error reporting/on-call, customer support and finance/refund operations.
- [ ] Rotate/revoke temporary access through service controls; transfer no credentials in this file, chat exports or tickets.

## Task-status appendix

Board entries are historical delivery/work records, not feature tests. Draft = suggested/unaccepted work, possibly stale or overlapping; Active may be on another branch; Ready awaits merge; Merged is delivered status; Archived is not mandatory work and does not imply user rejection. The handoff task itself remains Active while this snapshot is written.

**Final board refresh:** 2026-10-05 06:23 UTC, all 118 records: 40 Merged, 48 Draft, 2 Ready, 2 Active, 26 Archived. #117/#118 were suggested during preparation and are included as Drafts, not delivered changes. Repository HEAD was rechecked unchanged at the source baseline.

The following groups account for the complete refreshed board, including archived suggestions because this handoff explicitly requests reconciliation. Original task titles are retained for lookup; claims inside titles (such as “live” or “fix”) are not runtime evidence. Use the feature matrix/domain rules/roadmap above to interpret source and acceptance.

### Merged delivery records

| Ref | Title |
|---|---|
| #1 | Versa branding — app name & typography |
| #2 | 6% platform fee — audit & complete implementation |
| #3 | Edit venue and pitch details |
| #4 | Owner Settings + Stripe Connect payments |
| #5 | Update the memory about the Expo domain routing fix |
| #8 | Venue image uploads + player carousel on card and details |
| #16 | Prompt new owners to set up venue & pitch before reaching the dashboard |
| #17 | Make Outdoor the first option and default when adding a pitch |
| #18 | Add phone number search to owner booking dashboard |
| #19 | Owner Off-Days, Bank Holidays, and Blocked Hours |
| #29 | Owner notification bell and push notifications |
| #33 | Fix player profile image upload, crop, initials fallback |
| #37 | Add Users tab to Admin Portal |
| #38 | Fee enable confirmation dialog on per-venue override |
| #39 | Booking audit log — full activity trail for all roles |
| #40 | Admin venue detail view — full inspection before approve/reject |
| #51 | Add search bar to player My Bookings tab |
| #52 | Player Notification Bell |
| #53 | Favourite icon — filled red heart when active |
| #54 | Show available time slots on pitch cards in Venue Details |
| #60 | Player venue image carousel — card and details |
| #65 | Implement live Stripe payment system — player checkout and owner Connect |
| #71 | Secure text input handling |
| #72 | Add login rate limiting |
| #73 | Require unique user phones |
| #77 | Strengthen password policy and UX |
| #78 | Catch duplicate phone registrations under concurrent requests |
| #80 | Let players securely reset a forgotten password |
| #81 | Harden image upload validation against disguised/executable files |
| #82 | Token and database security hardening |
| #83 | Complete Versa password reset |
| #90 | Fix 15 security CVEs |
| #93 | Add fluid, accessible app-wide motion |
| #98 | Build owner subscription foundation |
| #99 | Add Pro match statistics |
| #101 | Add Pro insights and reminders |
| #102 | Build Elite tournament creator |
| #103 | Add Elite matchmaking and waitlists |
| #104 | Add Elite venue leaderboards |
| #105 | Make manual bookings a Pro feature |

### Active and Ready work

| Ref | Status | Title / reconciliation |
|---|---|---|
| #13 | Ready | Route booking payments to the owner's Stripe account at checkout — overlapping routing already visible; pending implementation not inspected |
| #96 | Ready | Restore form behavior after motion — no claim that its fixes are in baseline |
| #100 | Active | Add Pro growth tools — separate branch; described plan, not inspected implementation |
| #114 | Active | Comprehensive Versa developer handoff — this document; status before completion |

### Drafts: financial, setup, security and release verification

| Ref | Title / revalidation note |
|---|---|
| #6 | Prevent native app from silently hitting a dead API when the Replit domain changes again — native still compiled-host dependent |
| #10 | Make sure refunds reduce platform fees correctly in owner revenue — reporting helper has partial-refund fee limitation |
| #11 | Fix broken build checks so future changes can't ship silently broken — historic error details may be stale; reproduce first |
| #12 | Confirm fee math stays correct for deposits, waived fees, and refunds |
| #14 | Keep owner's Stripe Connect status current without manual refresh |
| #15 | Make sure owners can't get stuck if Stripe onboarding link expires |
| #30 | Make sure owner notifications still arrive when the app is in the background — needs physical builds |
| #48 | Make sure booking status changes can't silently skip the audit trail |
| #56 | Make sure players can't see another player's notifications if auth is misconfigured |
| #59 | Make sure the favourite heart icon looks right on all screens after the icon swap |
| #74 | Make the Expo project typecheck pass cleanly — overlaps #11; not rerun here |
| #79 | Catch account phone cleanup problems before database updates — review existing migration/tests first |
| #85 | Catch image upload security failures before they reach player profiles — byte validation exists; request-level gap needs revalidation |
| #86 | Catch mobile sessions failing after an app upgrade |
| #88 | Catch venue photo upload and cover-order regressions before owners see them |
| #94 | Catch owner payout routing failures before a booking is paid — depends on Ready #13 |
| #97 | Catch form controls becoming unresponsive after future motion changes — depends on Ready #96 |
| #106 | Connect SMS delivery and prove reminders arrive before launch |
| #110 | Make sure new databases can start with the full booking and match history schema — historical isolated test reports do not prove bootstrap |
| #113 | Prove tournament registrations and payments stay safe under simultaneous requests |
| #116 | Verify incentive checkout recovery against Stripe test payments — depends on unmerged growth work |
| #117 | Keep reminders and match recovery running when the API is idle — follow-up suggested during this handoff; no implementation |
| #118 | Keep profile photos from disappearing after a release or restart — follow-up suggested during this handoff; no implementation |

### Drafts: feature/UX and optional later work

| Ref | Title / scope note |
|---|---|
| #7 | Warn venue owners when unsaved pitch edits will break upcoming bookings |
| #9 | Prevent venue edit screen from losing changes if the app goes to background |
| #20 | Make sure new pitches always default to Outdoor across all entry points — default implementation is Merged; regression suggestion |
| #21 | Keep owners from losing onboarding progress if the app crashes mid-wizard |
| #22 | Show owners a clear next step after their venue is approved |
| #23 | Prevent a half-created venue from being stranded if the owner never finishes step 1 |
| #31 | Show owners when a booking is cancelled so they can rebook the slot — cancellation helper already has notification behavior; revalidate recipient/UI gaps |
| #32 | Prevent the notification badge count from going stale after the app resumes |
| #34 | Extend the initials avatar to owner and admin profiles so no one sees a broken icon |
| #35 | Prevent avatar uploads from silently breaking when the server rejects the file |
| #36 | Make sure avatar images don't reload from scratch every time the profile screen opens |
| #44 | Let admins suspend or reinstate user accounts from the Users tab |
| #45 | Make sure the admin Users tab loads correctly when there are many registered users |
| #46 | Prevent the admin Users count from going stale when a player deletes their account |
| #47 | Show audit history inline when an admin edits a booking |
| #49 | Let owners export their booking activity history as a CSV — existing booking CSV is not necessarily audit-history export |
| #55 | Let players mark a session as finished so they get a match recap notification — distinct from owner match records |
| #57 | Let players search bookings by player name or team when group bookings are added — conditional future scope |
| #58 | Make the booking search discoverable for players who don't notice it |
| #63 | Let players tap a photo to see it full-screen |
| #64 | Keep photo carousels smooth when the network is slow |
| #107 | Let players choose whether booking reminders are sent by SMS |
| #108 | Give owners a clear receipt for an offline booking payment |
| #109 | Help owners reconcile offline booking income at the end of each period |
| #115 | Show owners which discount codes actually improve bookings — depends on unmerged growth work; not current dashboard evidence |

### Archived records (not mandatory requirements)

These may include automatically archived suggestions. Neither archived status nor an old title proves rejection, missing implementation or a current defect. Reopen only after scope/risk review; do not silently add them to MVP.

| Ref | Title |
|---|---|
| #24 | Move booking search to the server so it works across all time periods |
| #25 | Make sure phone search still finds bookings when numbers are formatted differently |
| #26 | Stop players from seeing 'no slots available' with no explanation on blocked days |
| #27 | Let owners see which bookings will be affected before saving a block |
| #28 | Prevent drizzle migrations from silently failing when enum types already exist |
| #41 | Let admins filter venues by district or search by name |
| #42 | Prevent admins from approving a venue with no pitches or opening hours |
| #43 | Make sure the admin detail view handles very long venue data without layout breakage |
| #50 | Prevent admins from accidentally disabling fees on high-revenue venues |
| #61 | Let players tap a slot chip on a pitch card to jump straight to that slot in the booking flow |
| #62 | Prevent players from seeing stale slot availability after a booking completes |
| #66 | Prevent a Stripe payment from disappearing if the app closes mid-checkout |
| #67 | Confirm live Stripe test payments work end-to-end on device |
| #68 | Make sure cancelled bookings paid via Stripe get refunded to the correct card |
| #69 | Fix Expo stuck-on-loading caused by stale Metro port collision |
| #70 | Prevent the app from getting stuck if Metro takes too long to print its port |
| #75 | Preserve per-person login limits behind future trusted proxies |
| #76 | Catch generic login privacy regressions automatically |
| #84 | Catch password-reset security regressions before release |
| #87 | Confirm password-recovery emails work after Versa is published |
| #89 | Remove high-risk dependency issues before players use the app |
| #91 | Add Greek language for players and venue owners |
| #92 | Catch Greek-language regressions before app updates ship |
| #95 | Catch motion accessibility regressions before they reach users |
| #111 | Make sure Elite matches stay conflict-free when many players act at once |
| #112 | Let teammates confirm before their name is used in an Elite squad |

### Refresh protocol

Before using this appendix for implementation, fetch **all** task records (a single unfiltered response can be truncated), compare revision and task timestamps, read the relevant full plans and inspect the resulting merged diff. Preserve the distinction between source observation, prior reported checks and newly executed proof. Do not merge, migrate or configure a provider as a side effect of updating this handoff.

### Document verification record

Preparation verified repository-relative Markdown links, table-of-contents anchors, package-script names and one-to-one appendix reference/title/status coverage against the refreshed board. A text redaction check and manual inspection found no credential values, real account details, production records or credential-bearing URLs in this handoff. Only this file and the README handoff link were changed.

Application/build/typecheck/security/provider/database/browser/device/release checks remain **not run** for this documentation-only task. Their commands, prerequisites, hazards and acceptance gates are documented above; none is implied by successful document validation.
