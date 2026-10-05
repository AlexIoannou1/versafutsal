# FutsalCY — Futsal Booking Platform

A premium mobile futsal booking platform for Cyprus. Two-sided marketplace connecting players with venues for live availability, secure payments, and professional venue management.

## Developer handoff

The app is currently branded **Versa**. See [DEVELOPER_HANDOFF.md](DEVELOPER_HANDOFF.md) for the current source/task snapshot, safe onboarding, feature status, domain rules, setup risks and release checklist. The abbreviated setup below is not proof of clean database bootstrap or production readiness.

## Architecture

- **Mobile App**: Expo (React Native) — Player, Venue Owner, and Admin roles
- **Backend API**: Express (TypeScript) on the shared api-server
- **Database**: PostgreSQL via Drizzle ORM
- **Auth**: JWT (email/password)

## Getting Started

### Prerequisites
- Node.js 24+
- pnpm
- PostgreSQL database (set `DATABASE_URL` env var)

### Install dependencies
```bash
pnpm install
```

### Push database schema
```bash
pnpm --filter @workspace/db run push
```

### Seed demo data

Set a non-production password that meets the app password policy, then:

```bash
export DEMO_SEED_PASSWORD='choose-a-unique-demo-password'
pnpm --filter @workspace/api-server run seed
```

### Start the API server
```bash
pnpm --filter @workspace/api-server run dev
```

### Start the mobile app
```bash
pnpm --filter @workspace/futsalcy run dev
```

---

## Seeded Demo Accounts

All seeded accounts use the `DEMO_SEED_PASSWORD` you choose above.

| Role | Email |
|------|-------|
| Player | player@futsalcy.com |
| Venue Owner | owner@futsalcy.com |
| Admin | admin@futsalcy.com |

### Seeded Venues
1. **Nicosia Futsal Center** — 3 pitches (5v5 x2, 7v7 x1) — **PENDING approval**
2. **Limassol Sports Arena** — 2 pitches (5v5 x2) — **PENDING approval**

Both venues start in **PENDING** state so the Admin role can demonstrate venue approval workflow.

---

## Key Commands

| Command | Description |
|---------|-------------|
| `pnpm --filter @workspace/api-spec run codegen` | Regenerate API hooks from OpenAPI spec |
| `pnpm --filter @workspace/db run generate` | Generate migration files from schema |
| `pnpm --filter @workspace/db run migrate` | Apply pending migrations |
| `pnpm --filter @workspace/db run push` | Push schema changes to DB (dev only) |
| `pnpm --filter @workspace/api-server run seed` | Seed demo data |
| `pnpm run typecheck` | Full TypeScript typecheck |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | **Yes** | JWT signing secret — server refuses to start without it |
| `PORT` | Yes | Server port (injected by Replit) |
| `EXPO_PUBLIC_DOMAIN` | Yes | Domain for Expo → API communication |
| `PASSWORD_RESET_WEB_URL` | Production | Public HTTPS URL of the Versa `/reset-password` page; no query string or fragment |
| `PASSWORD_RESET_FROM_EMAIL` | Production | Verified Versa sender for password-recovery email, e.g. `Versa <security@your-domain>` |
| `PASSWORD_RESET_APP_URL` | No | Optional `versafutsalapp://reset-password` deep-link destination for installed apps |

In development, password-reset emails use the current Replit app's
`/reset-password` page when `PASSWORD_RESET_WEB_URL` is not set. In production,
both `PASSWORD_RESET_WEB_URL` and `PASSWORD_RESET_FROM_EMAIL` are required before
emails can be delivered; the API returns the same generic response whether email
delivery is configured or an account exists.

---

## Roles

- **PLAYER** — Discovers venues, books pitches, manages bookings
- **VENUE_OWNER** — Manages venues/pitches, views bookings calendar, receives payments
- **ADMIN** — Approves venues, manages users/bookings/payments, controls fee settings
