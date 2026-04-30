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
- `artifacts/api-server/src/routes/auth.ts` — /auth/register, /auth/login, /auth/me
- `lib/db/src/schema/` — Drizzle schema (users, venues, pitches, bookings, payments, …)
- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for codegen)

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
