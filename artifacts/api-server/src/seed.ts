/**
 * FutsalCY Demo Seed Script
 *
 * Creates demo data for piloting with venues.
 * Run: pnpm --filter @workspace/api-server run seed
 *
 * Seeded credentials:
 *   PLAYER:       player@futsalcy.com   / Demo1234!
 *   VENUE_OWNER:  owner@futsalcy.com    / Demo1234!
 *   ADMIN:        admin@futsalcy.com    / Demo1234!
 */

import bcrypt from "bcryptjs";
import { db, pool } from "@workspace/db";
import {
  usersTable,
  venuesTable,
  pitchesTable,
  openingHoursTable,
  pricingRulesTable,
  adminSettingsTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";

async function seed() {
  console.log("🌱 Seeding FutsalCY database...\n");

  // ─── Admin Settings ──────────────────────────────────────────────────────
  const existing = await db.select().from(adminSettingsTable).limit(1);
  let adminSettingsId: string;

  if (existing.length === 0) {
    const [settings] = await db
      .insert(adminSettingsTable)
      .values({ feeEnabled: true, feeAmount: "1.00", perVenueOverrides: {} })
      .returning();
    adminSettingsId = settings.id;
    console.log("✅ Admin settings created");
  } else {
    adminSettingsId = existing[0].id;
    console.log("ℹ️  Admin settings already exist, skipping");
  }

  // ─── Users ───────────────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash("Demo1234!", 12);

  const userDefs = [
    { email: "player@futsalcy.com", name: "Alex Petridis", role: "PLAYER" as const },
    { email: "owner@futsalcy.com", name: "Maria Ioannou", role: "VENUE_OWNER" as const },
    { email: "admin@futsalcy.com", name: "Platform Admin", role: "ADMIN" as const },
  ];

  const userIds: Record<string, string> = {};

  for (const u of userDefs) {
    const [existing] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, u.email))
      .limit(1);

    if (existing) {
      userIds[u.role] = existing.id;
      console.log(`ℹ️  User ${u.email} already exists, skipping`);
    } else {
      const [user] = await db
        .insert(usersTable)
        .values({ email: u.email, name: u.name, role: u.role, passwordHash })
        .returning();
      userIds[u.role] = user.id;
      console.log(`✅ Created ${u.role}: ${u.email}`);
    }
  }

  const ownerId = userIds["VENUE_OWNER"];

  // ─── Venue 1: Nicosia Futsal Center ──────────────────────────────────────
  const [existingVenue1] = await db
    .select()
    .from(venuesTable)
    .where(eq(venuesTable.name, "Nicosia Futsal Center"))
    .limit(1);

  let venue1Id: string;

  if (existingVenue1) {
    venue1Id = existingVenue1.id;
    console.log("ℹ️  Venue 1 already exists, skipping");
  } else {
    const [venue1] = await db
      .insert(venuesTable)
      .values({
        ownerId,
        status: "PENDING",
        name: "Nicosia Futsal Center",
        district: "Nicosia",
        address: "25 Makarios Avenue, Nicosia 1065",
        description:
          "Modern futsal facility in the heart of Nicosia with 3 professional-grade pitches, fully equipped changing rooms, and a café.",
        amenities: ["Changing Rooms", "Showers", "Parking", "Café", "WiFi"],
        cancellationWindowHours: 24,
      })
      .returning();

    venue1Id = venue1.id;
    console.log(`✅ Created venue (PENDING): ${venue1.name}`);

    // Pitches for venue 1
    const pitchDefs1 = [
      { name: "Pitch A - 5v5", size: "5v5", type: "INDOOR" as const },
      { name: "Pitch B - 5v5", size: "5v5", type: "INDOOR" as const },
      { name: "Pitch C - 7v7", size: "7v7", type: "OUTDOOR" as const },
    ];

    for (const pd of pitchDefs1) {
      const [pitch] = await db
        .insert(pitchesTable)
        .values({ venueId: venue1Id, ...pd, slotDurationMinutes: 60 })
        .returning();

      // Pricing: weekday €20/hr, weekend €28/hr
      await db.insert(pricingRulesTable).values([
        { pitchId: pitch.id, dayType: "WEEKDAY", pricePerHour: "20.00", depositType: "FIXED", depositAmount: "10.00" },
        { pitchId: pitch.id, dayType: "WEEKEND", pricePerHour: "28.00", depositType: "FIXED", depositAmount: "14.00" },
      ]);

      console.log(`  ✅ Pitch: ${pitch.name}`);
    }

    // Opening hours (Mon-Fri 08:00-23:00, Sat-Sun 09:00-22:00)
    const hoursV1 = [
      { dayOfWeek: 0, openTime: "09:00", closeTime: "22:00", isClosed: false }, // Sun
      { dayOfWeek: 1, openTime: "08:00", closeTime: "23:00", isClosed: false }, // Mon
      { dayOfWeek: 2, openTime: "08:00", closeTime: "23:00", isClosed: false }, // Tue
      { dayOfWeek: 3, openTime: "08:00", closeTime: "23:00", isClosed: false }, // Wed
      { dayOfWeek: 4, openTime: "08:00", closeTime: "23:00", isClosed: false }, // Thu
      { dayOfWeek: 5, openTime: "08:00", closeTime: "23:00", isClosed: false }, // Fri
      { dayOfWeek: 6, openTime: "09:00", closeTime: "22:00", isClosed: false }, // Sat
    ];

    await db.insert(openingHoursTable).values(
      hoursV1.map((h) => ({ venueId: venue1Id, ...h })),
    );
    console.log("  ✅ Opening hours added");
  }

  // ─── Venue 2: Limassol Sports Arena (PENDING) ─────────────────────────────
  const [existingVenue2] = await db
    .select()
    .from(venuesTable)
    .where(eq(venuesTable.name, "Limassol Sports Arena"))
    .limit(1);

  let venue2Id: string;

  if (existingVenue2) {
    venue2Id = existingVenue2.id;
    console.log("ℹ️  Venue 2 already exists, skipping");
  } else {
    const [venue2] = await db
      .insert(venuesTable)
      .values({
        ownerId,
        status: "PENDING",
        name: "Limassol Sports Arena",
        district: "Limassol",
        address: "12 Spyros Kyprianou Ave, Limassol 3070",
        description:
          "Brand new sports complex with 2 futsal pitches and a dedicated fitness area. Pending approval.",
        amenities: ["Changing Rooms", "Showers", "Parking", "Fitness Area"],
        cancellationWindowHours: 48,
      })
      .returning();

    venue2Id = venue2.id;
    console.log(`✅ Created venue (PENDING): ${venue2.name}`);

    const pitchDefs2 = [
      { name: "Main Pitch - 5v5", size: "5v5", type: "INDOOR" as const },
      { name: "Side Pitch - 5v5", size: "5v5", type: "OUTDOOR" as const },
    ];

    for (const pd of pitchDefs2) {
      const [pitch] = await db
        .insert(pitchesTable)
        .values({ venueId: venue2Id, ...pd, slotDurationMinutes: 60 })
        .returning();

      await db.insert(pricingRulesTable).values([
        { pitchId: pitch.id, dayType: "WEEKDAY", pricePerHour: "18.00", depositType: "PERCENT", depositAmount: "50" },
        { pitchId: pitch.id, dayType: "WEEKEND", pricePerHour: "25.00", depositType: "PERCENT", depositAmount: "50" },
      ]);

      console.log(`  ✅ Pitch: ${pitch.name}`);
    }

    const hoursV2 = [
      { dayOfWeek: 0, openTime: "10:00", closeTime: "20:00", isClosed: false },
      { dayOfWeek: 1, openTime: "09:00", closeTime: "22:00", isClosed: false },
      { dayOfWeek: 2, openTime: "09:00", closeTime: "22:00", isClosed: false },
      { dayOfWeek: 3, openTime: "09:00", closeTime: "22:00", isClosed: false },
      { dayOfWeek: 4, openTime: "09:00", closeTime: "22:00", isClosed: false },
      { dayOfWeek: 5, openTime: "09:00", closeTime: "22:00", isClosed: false },
      { dayOfWeek: 6, openTime: "10:00", closeTime: "21:00", isClosed: false },
    ];

    await db.insert(openingHoursTable).values(
      hoursV2.map((h) => ({ venueId: venue2Id, ...h })),
    );
    console.log("  ✅ Opening hours added");
  }

  await pool.end();

  console.log("\n✅ Seed complete!\n");
  console.log("─────────────────────────────────────────────");
  console.log("Demo credentials:");
  console.log("  PLAYER:      player@futsalcy.com / Demo1234!");
  console.log("  VENUE_OWNER: owner@futsalcy.com  / Demo1234!");
  console.log("  ADMIN:       admin@futsalcy.com  / Demo1234!");
  console.log("─────────────────────────────────────────────\n");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
