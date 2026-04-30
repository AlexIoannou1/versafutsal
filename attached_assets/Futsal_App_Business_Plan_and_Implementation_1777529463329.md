# Cyprus Futsal Booking Platform — Business Plan + Implementation Plan

**Document purpose**
This document consolidates the business plan, monetization options, go-to-market approach, product scope, risks, and a practical implementation plan for a premium mobile futsal reservation and venue management platform in Cyprus.

**Working product concept**
A two-sided sports booking platform (similar quality to premium padel booking apps), focused on futsal/mini-football.

**Roles**
- **Player**: discovers venues, views live availability, books and pays, organizes games.
- **Venue Owner**: manages venues/pitches/schedules/pricing, bookings calendar, payments, analytics.
- **Platform Admin**: approves venues, monitors users/bookings/payments, handles refunds/disputes and commissions.

---

## 1) Executive Summary

Cyprus has strong futsal/mini-football participation and many venues operate bookings via phone/WhatsApp/DMs with manual coordination. The proposed app becomes the default place to **see live pitch availability and book/pay**, while giving venues a professional **calendar, payment, and reporting system**.

This can become a profitable local business if the product is **venue-first**, nails **availability + deposits + calendar reliability**, and is sold via **high-touch onboarding** to create quick coverage in 1–2 cities.

**Primary monetization decision (current)**
The platform charges players a **€1 convenience fee per booking** (displayed transparently during checkout). This is designed to feel negligible when groups use split payments, but the system must also work smoothly when a single “captain” pays for the booking.

---

## 2) The Problem (Venue Pain)

Common problems for futsal venues in Cyprus:
- **Manual booking workload**: staff spend time on calls/messages and switching between channels.
- **No real-time availability**: double-bookings, miscommunication, and missed bookings.
- **No-show risk**: weak deposit workflows and inconsistent cancellation policies.
- **Revenue leakage**: empty off-peak hours because discovery and conversion are weak.
- **Limited insights**: little visibility into occupancy, peak hours, cancellations, customer frequency.

What venues already do (and why it’s hard to replace):
- WhatsApp/phone is convenient and “works,” but it doesn’t scale and creates hidden costs.

---

## 3) The Solution (What You’re Selling)

### 3.1 Player Value
- Venue discovery with filters (location, indoor/outdoor, pitch size, availability, price)
- Venue details: photos, amenities, map, pitch list
- Real-time availability calendar by date/hour
- Booking flow with online payment options:
  - full payment
  - deposit
  - split payment with teammates (later)
- Booking types (later): public match, team vs team, recurring

### 3.2 Venue Owner Value (Primary Paying Customer)
- Register/manage one or multiple venues
- Configure pitches, schedules, pricing rules
- Block slots for maintenance/events
- Booking calendar + reservation management
- Payments: deposits, refunds, settlement reporting
- Analytics: occupancy, revenue, cancellations, best slots
- Promotions/discount codes (later)

### 3.3 Platform Admin Value
- Venue approval workflow
- User management
- Monitor bookings, payments, and refunds
- Disputes/refunds and commission tracking

---

## 4) Target Market and Positioning

### Primary customer (pays): Venue Owners/Operators
- Single-venue operators
- Multi-pitch venues
- Venues that run frequent bookings and want fewer no-shows

### Secondary customer (drives volume): Players & Teams
- Weekly groups
- Competitive teams
- Tourists/expats needing discovery + easy booking

**Positioning statement**
“Playtomic-quality booking for futsal in Cyprus: live availability, deposits, and an owner calendar that just works.”

---

## 5) Monetization & Profitability

A strong strategy mixes **transaction fees + subscriptions + add-ons**.

### 5.1 Per-Booking Service Fee (Chosen Model: Player-Paid €1)

**Chosen model**
- Charge the player side a **€1 convenience fee per completed booking**.
- The fee is shown early and clearly (no surprise fees at the final step).

**Fee splitting reality**
- Many groups will have one person (“captain”) pay for the booking. In that case, the captain pays the full €1.
- To support the “negligible per player” narrative in Cyprus, **split payments should be treated as a high-priority follow-up** (so the €1 can be distributed across teammates when they opt in).

**Recommended fee modes (support both)**
- **Captain pays**: one payer covers the booking total + €1 fee.
- **Split payment** (V1 priority): invite link for teammates to pay their share; booking is confirmed once deposit/full amount rules are met.

**Adoption lever for pilots**
- For early venue pilots, keep a capability to **waive the €1 fee** (feature flag / promo) to reduce friction during onboarding and prove value.

**Alternative models (keep as backup if conversion is weak)**
- Venue-paid fee (e.g., €0.50–€1.00 per booking)
- Subscription-only, or subscription + lower booking fee

### 5.2 Venue Subscription Plans (Stabilizes Revenue)
Suggested tiers (examples; adjust per market feedback):
- **Starter (€0–€19/mo)**: listing + basic calendar
- **Pro (€49–€99/mo)**: booking engine + deposits + analytics + support
- **Multi-venue (€149+/mo)**: multiple venues, staff roles, advanced reporting

You can offer either:
- subscription-only, or
- subscription + lower per-booking fee

### 5.3 Payment Processing / Platform Commission
If the platform processes card payments:
- You can incorporate a small platform commission (venue-paid) where feasible.
- Keep pricing transparent and simple for Cyprus venues.

### 5.4 Add-ons (High Margin)
- SMS bundles (reminders)
- Promoted placement in discovery
- Advanced analytics exports (CSV, monthly reports)
- Custom branding / booking page
- Additional staff accounts/roles

### 5.5 Parties & Tournaments (Custom Venue Feature)
Many venues run birthdays and tournaments. To avoid destroying margins:
- Treat these as **paid add-ons**, not core MVP.
- Monetize via:
  - one-time setup fee per venue (depending on complexity), and/or
  - premium subscription tier, and/or
  - per-ticket / per-team registration commission

---

## 6) Simple Unit Economics Example (For Pitching)

Assume a venue generates 300 bookings/month through the app.
- At **€0.75 per booking**, revenue to platform = **€225/month** from that venue.

Venue ROI narrative:
- If the system increases utilization by only a few extra bookings per week and reduces no-shows via deposits, the venue’s incremental revenue can exceed the fee.

---

## 7) Go-To-Market Plan (Cyprus Reality)

You have a major advantage: you are a player and can sell locally.

### 7.1 Phase 1 — Supply First (Venues)
Goal: Coverage and credibility.
- Sign **10–15 venues** across districts, but prioritize one “anchor” city first.
- Offer white-glove onboarding:
  - you set up pitches, schedules, pricing rules, policies
  - you train staff
- Use an early partner deal:
  - free trial (e.g., 60–90 days) or reduced fees

### 7.2 Phase 2 — Demand Activation (Players)
Goal: Drive bookings through installed supply.
- Onboard captains: weekly groups and corporate groups.
- Use “public match” later to fill off-peak hours.
- Partner with academies and recurring groups.

### 7.3 Sales Motion (Phone + Demo)
What to sell:
- “We reduce your admin time, enable deposits, reduce no-shows, and show occupancy/revenue by hour.”

What to offer:
- done-for-you setup in 1–2 days
- trial period
- keep phone bookings alongside the app initially
- for early pilots, the ability to waive the **€1 player booking fee** (to prove value and reduce friction)

---

## 8) Unbiased Reality Check (Why It Can / Can’t Excel)

### Why it’s promising
- Venue pain is real and financial (no-shows, admin time, lost bookings).
- If deposits and reminders are implemented well, the value is immediately clear.

### Main failure modes
- Cold start: players won’t install without venues; venues won’t switch without demand.
- Owner inertia: “WhatsApp is good enough.”
- Pricing pushback if ROI is not demonstrated.
- Custom-feature trap: too many bespoke party/tournament requests early.

### What would strongly indicate success
- You can sign 10+ venues in one city quickly with onboarding.
- The booking engine is reliable and removes admin work.
- Deposits + reminders reduce no-shows.

---

## 9) Product Scope & Roadmap (Build the Wedge First)

The correct wedge is **venue operations + payments**. Social features come after bookings flow.

### 9.1 MVP (Ship This First)
Non-negotiables:
- **Live availability** (single source of truth)
- **Bookings** (create, confirm, cancel, reschedule)
- **Deposits/full payment**
- **Checkout fee support** (player-paid **€1 per booking**) with clear display and reporting
- **Cancellation policy + refunds (basic)**
- **Owner calendar** (day/week views + filters)
- **Payouts/settlement reporting** (what the venue earned, what the platform fee was)
- Push/in-app notifications: confirmation + reminders
- Admin tools for: venue approval + refund workflow

Intentionally defer:
- Public matches, matchmaking
- Teams and stats
- Tournaments/parties modules
- Split payments (but treat as **V1 high priority** to support group adoption)

### 9.2 V1 (After MVP Proves Bookings)
- **Split payments (high priority)**
  - invite teammates to pay their share
  - optional fee splitting (so the €1 can be distributed)
  - clear “who has paid” status for the captain
- Wallet/credits
- Promotions/discount codes
- Staff roles for venues
- Public matches (simple)

### 9.3 V2 (Upsell / Expansion)
- Tournaments/party module (paid add-on)
- League scheduling
- Advanced analytics + CRM exports

---

## 10) Operational Policies (Critical Early)

Define these early; they impact trust and support load:
- Cancellation windows and penalties (venue-configurable but platform-limited)
- Refund rules (full vs partial; deposit handling)
- No-show policy
- Payment settlement schedule (weekly/bi-weekly)
- Chargeback/dispute handling

---

## 11) KPIs (What to Track)

Venue KPIs:
- bookings per venue per month
- occupancy by hour/day
- cancellation rate
- no-show rate (if tracked)
- revenue and average booking value

Player KPIs:
- conversion: venue view → slot selection → payment
- repeat booking rate

Business KPIs:
- revenue per venue
- venue churn
- support volume per 100 bookings

---

## 12) Implementation Plan (Solo-Developer Friendly)

This is a pragmatic plan that prioritizes an MVP you can sell.

### 12.1 Implementation Principles
- Build **reliability first** (availability + calendar correctness).
- Keep workflows standardized; avoid bespoke work.
- Use feature flags to keep future features out of the MVP path.

### 12.2 MVP Architecture (High-Level)
Suggested components:
- **Mobile app** (Player + Venue Owner experiences)
- **Admin web panel** (faster for operations than mobile)
- **Backend API** (auth, bookings, payments, notifications)
- **Database** (venues, pitches, slots, bookings, users, payments)

Key system properties:
- Role-based access control
- Real-time availability (strong concurrency rules)
- Idempotent payment + booking confirmation
- Audit log for booking changes

### 12.3 Data Model (Conceptual)
Core entities:
- User (role: player/owner/admin)
- Venue
- Pitch
- Schedule / OpeningHours
- PricingRule
- Booking (status: pending/paid/confirmed/cancelled/refunded)
- PaymentIntent / Payment
- Settlement / Payout
- Notification

### 12.4 MVP Build Steps (Milestones)

**Milestone A — Foundations**
- Authentication (player/owner/admin)
- Venue onboarding flows (owner creates venue)
- Pitch setup + hours + pricing

**Milestone B — Availability Engine (Most Important)**
- Generate available slots from opening hours + pitch + slot duration
- Block slots for maintenance
- Prevent double booking (atomic booking creation)

**Milestone C — Booking Flow + Payments**
- Booking creation and confirmation
- Deposit vs full payment
- Apply and report the **€1 player booking fee** (feature-flag capable for pilots)
- Booking receipts and confirmation notifications

**Milestone D — Cancellations + Refunds**
- Venue-configurable cancellation rules (within bounds)
- Refund tool for admin and owner
- Audit trail for every change

**Milestone E — Owner Calendar + Settlement Reporting**
- Calendar views (day/week)
- Filters by pitch
- Revenue and settlement summaries

**Milestone F — Admin Console (Minimum Needed)**
- Venue approvals
- Booking/payment monitoring
- Refund/dispute workflow

### 12.5 Demo Plan (Before Full Launch)
To sell venues while still building:
- Create a high-quality demo environment with:
  - 2–3 sample venues
  - realistic pitches/hours/prices
  - working booking + deposit
  - owner calendar showing bookings

### 12.6 Rollout Plan (Pilot)
- Pilot with 2–3 venues first.
- Run in parallel with existing phone bookings.
- Measure:
  - booking volume
  - no-show reduction
  - staff time saved
- Iterate quickly, then scale to 10+ venues in one city.

---

## 13) Next Actions (Development Start Checklist)

1) Choose your initial wedge city (e.g., Nicosia) and list target venues.
2) Decide pricing for the pilot (trial + fee plan).
3) Lock MVP scope: availability, bookings, deposits, cancellations, owner calendar, settlement reporting.
4) Start building demo-first: one polished booking flow + one polished owner calendar.

---

## Appendix A — Feature Inventory (From Original Idea)

### Player (future-ready list)
- Discover venues, filters, details
- Real-time availability
- Booking + payments (full/deposit/split)
- Public matches + join
- Matchmaking by area/skill/time
- Teams, profiles, stats
- Wallet/credits, promo codes
- Notifications

### Venue Owner (future-ready list)
- Venue setup, pitch management
- Calendar + reservation management
- Payments dashboard
- Customer list
- Analytics
- Promotions

### Admin
- Approvals
- User management
- Booking/payment monitoring
- Disputes/refunds
- Commission management
