# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Project: FutsalCY

Cyprus futsal booking platform (two-sided marketplace).
- **Mobile app**: Expo/React Native at `artifacts/futsalcy/`
- **Backend**: Express 5 API at `artifacts/api-server/`
- **Auth**: JWT (email/password), 3 roles: PLAYER, VENUE_OWNER, ADMIN

### Demo credentials (after seeding)
| Role | Email | Password |
|------|-------|----------|
| Player | player@futsalcy.com | Demo1234! |
| Venue Owner | owner@futsalcy.com | Demo1234! |
| Admin | admin@futsalcy.com | Demo1234! |

### Key files
- `artifacts/futsalcy/app/_layout.tsx` — root layout with AuthProvider, QueryClient, fonts
- `artifacts/futsalcy/context/AuthContext.tsx` — auth state, login/logout, role
- `artifacts/futsalcy/app/index.tsx` — root redirect (role → tab group)
- `artifacts/futsalcy/app/(auth)/` — mode-select, login, register screens
- `artifacts/futsalcy/app/(player)/` — Player tab group (Venues, Bookings, Profile)
- `artifacts/futsalcy/app/(owner)/` — Owner tab group (Dashboard, Venues, Profile)
- `artifacts/futsalcy/app/(admin)/` — Admin tab group (Overview, Venue Approvals, Profile)
- `artifacts/futsalcy/app/player/venue/[id]/book.tsx` — Booking screen (date strip + slot grid + confirm CTA)
- `artifacts/futsalcy/app/player/booking/[id].tsx` — Booking confirmation / detail screen
- `artifacts/futsalcy/app/(player)/bookings.tsx` — Player booking history list
- `artifacts/futsalcy/app/(owner)/index.tsx` — Owner dashboard (booking stats + upcoming/past lists)
- `artifacts/api-server/src/routes/bookings.ts` — Availability engine + booking CRUD routes
- `artifacts/api-server/src/routes/auth.ts` — /auth/register, /auth/login, /auth/me
- `lib/db/src/schema/` — Drizzle schema (users, venues, pitches, bookings, maintenanceBlocks, …)
- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for codegen)

### Payment & Notification API Endpoints (Task #4)
- `POST /api/bookings/:bookingId/checkout` — confirm booking + charge €1 fee (idempotent, MockPaymentProvider)
- `GET /api/checkout/fee` — get current platform fee for a venue (respects per-venue overrides)
- `PATCH /api/auth/push-token` — register Expo push token for current user
- `GET /api/admin/settings` — get global fee settings (ADMIN only)
- `PATCH /api/admin/settings` — update `feeEnabled` / `feeAmount` (ADMIN only)
- `PATCH /api/admin/settings/venues/:venueId` — set per-venue fee override (ADMIN only)

Admin settings screen: `(admin)/index.tsx` — fee toggle, fee amount edit, per-venue override list  
Push notification hook: `hooks/usePushNotifications.ts` — requests permission + registers token on login  
MockPaymentProvider: `api-server/src/lib/payment-provider.ts` — always succeeds, mirrors Stripe interface  
Notifications helper: `api-server/src/lib/notifications.ts` — in-app + Expo push (non-fatal)

### Booking API Endpoints (Task #3)
- `GET /api/venues/:venueId/pitches/:pitchId/availability?date=YYYY-MM-DD` — slot grid (open hours - maintenance blocks - existing bookings)
- `POST /api/bookings` — create booking (concurrency-safe via PG unique constraint `unique_pitch_slot`)
- `GET /api/player/bookings` / `GET /api/player/bookings/:id` — player booking history
- `GET /api/owner/bookings` — owner booking list with player/venue/pitch details
- `POST/DELETE /api/owner/venues/:venueId/pitches/:pitchId/blocks` — maintenance block CRUD

Booking unique constraint: `(pitch_id, start_at)` prevents double-booking.  
Drizzle wraps PG errors — check `err.cause?.code === "23505"` for unique constraint violations.

### Colors (FutsalCY brand)
- Primary green: `#00C851`
- Dark background: `#0F1923`
- Card dark: `#1C2B39`
- Border radius: `12`

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `pnpm --filter @workspace/api-server run seed` — seed demo data

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
