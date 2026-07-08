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
      .values({ feeEnabled: true, feePercent: "6.00", perVenueOverrides: {} })
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
    { email: "player@futsalcy.com", name: "Alex Petridis", role: "PLAYER" as const, phoneNumber: "+357 99 123456" },
    { email: "owner@futsalcy.com", name: "Maria Ioannou", role: "VENUE_OWNER" as const, phoneNumber: "+357 96 234567" },
    { email: "owner2@futsalcy.com", name: "Nikos Stavrou", role: "VENUE_OWNER" as const, phoneNumber: "+357 97 345678" },
    { email: "admin@futsalcy.com", name: "Platform Admin", role: "ADMIN" as const, phoneNumber: "+357 22 000001" },
  ];

  const userIds: Record<string, string> = {};

  for (const u of userDefs) {
    const [existing] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, u.email))
      .limit(1);

    if (existing) {
      userIds[u.email] = existing.id;
      console.log(`ℹ️  User ${u.email} already exists, skipping`);
    } else {
      const [user] = await db
        .insert(usersTable)
        .values({ email: u.email, name: u.name, role: u.role, passwordHash, phoneNumber: u.phoneNumber })
        .returning();
      userIds[u.email] = user.id;
      console.log(`✅ Created ${u.role}: ${u.email}`);
    }
  }

  const ownerId = userIds["owner@futsalcy.com"];
  const owner2Id = userIds["owner2@futsalcy.com"];

  // ─── Venue 1: Nicosia Futsal Center (APPROVED) ────────────────────────────
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
        status: "APPROVED",
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
    console.log(`✅ Created venue (APPROVED): ${venue1.name}`);

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

      await db.insert(pricingRulesTable).values([
        { pitchId: pitch.id, dayType: "WEEKDAY", pricePerHour: "20.00", depositType: "FIXED", depositAmount: "10.00" },
        { pitchId: pitch.id, dayType: "WEEKEND", pricePerHour: "28.00", depositType: "FIXED", depositAmount: "14.00" },
      ]);

      console.log(`  ✅ Pitch: ${pitch.name}`);
    }

    await db.insert(openingHoursTable).values([
      { venueId: venue1Id, dayOfWeek: 0, openTime: "09:00", closeTime: "22:00", isClosed: false },
      { venueId: venue1Id, dayOfWeek: 1, openTime: "08:00", closeTime: "23:00", isClosed: false },
      { venueId: venue1Id, dayOfWeek: 2, openTime: "08:00", closeTime: "23:00", isClosed: false },
      { venueId: venue1Id, dayOfWeek: 3, openTime: "08:00", closeTime: "23:00", isClosed: false },
      { venueId: venue1Id, dayOfWeek: 4, openTime: "08:00", closeTime: "23:00", isClosed: false },
      { venueId: venue1Id, dayOfWeek: 5, openTime: "08:00", closeTime: "23:00", isClosed: false },
      { venueId: venue1Id, dayOfWeek: 6, openTime: "09:00", closeTime: "22:00", isClosed: false },
    ]);
    console.log("  ✅ Opening hours added");
  }

  // ─── Venue 2: Limassol Sports Arena (APPROVED) ────────────────────────────
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
        status: "APPROVED",
        name: "Limassol Sports Arena",
        district: "Limassol",
        address: "12 Spyros Kyprianou Ave, Limassol 3070",
        description:
          "Brand new sports complex with 2 futsal pitches and a dedicated fitness area.",
        amenities: ["Changing Rooms", "Showers", "Parking", "Fitness Area"],
        cancellationWindowHours: 48,
      })
      .returning();

    venue2Id = venue2.id;
    console.log(`✅ Created venue (APPROVED): ${venue2.name}`);

    for (const pd of [
      { name: "Main Pitch - 5v5", size: "5v5", type: "INDOOR" as const },
      { name: "Side Pitch - 5v5", size: "5v5", type: "OUTDOOR" as const },
    ]) {
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

    await db.insert(openingHoursTable).values([
      { venueId: venue2Id, dayOfWeek: 0, openTime: "10:00", closeTime: "20:00", isClosed: false },
      { venueId: venue2Id, dayOfWeek: 1, openTime: "09:00", closeTime: "22:00", isClosed: false },
      { venueId: venue2Id, dayOfWeek: 2, openTime: "09:00", closeTime: "22:00", isClosed: false },
      { venueId: venue2Id, dayOfWeek: 3, openTime: "09:00", closeTime: "22:00", isClosed: false },
      { venueId: venue2Id, dayOfWeek: 4, openTime: "09:00", closeTime: "22:00", isClosed: false },
      { venueId: venue2Id, dayOfWeek: 5, openTime: "09:00", closeTime: "22:00", isClosed: false },
      { venueId: venue2Id, dayOfWeek: 6, openTime: "10:00", closeTime: "21:00", isClosed: false },
    ]);
    console.log("  ✅ Opening hours added");
  }

  // ─── Venue 3: Larnaca Beach Futsal (APPROVED) ────────────────────────────
  const [existingVenue3] = await db
    .select()
    .from(venuesTable)
    .where(eq(venuesTable.name, "Larnaca Beach Futsal"))
    .limit(1);

  if (!existingVenue3) {
    const [venue3] = await db
      .insert(venuesTable)
      .values({
        ownerId: owner2Id,
        status: "APPROVED",
        name: "Larnaca Beach Futsal",
        district: "Larnaca",
        address: "5 Finikoudes Promenade, Larnaca 6023",
        description:
          "Seafront futsal facility with two all-weather outdoor pitches and stunning sea views. Open year-round.",
        amenities: ["Parking", "Outdoor Pitches", "Floodlights", "Café"],
        cancellationWindowHours: 12,
      })
      .returning();

    console.log(`✅ Created venue (APPROVED): ${venue3.name}`);

    for (const pd of [
      { name: "Pitch 1 - 5v5 Outdoor", size: "5v5", type: "OUTDOOR" as const },
      { name: "Pitch 2 - 6v6 Hybrid", size: "6v6", type: "HYBRID" as const },
    ]) {
      const [pitch] = await db
        .insert(pitchesTable)
        .values({ venueId: venue3.id, ...pd, slotDurationMinutes: 60 })
        .returning();

      await db.insert(pricingRulesTable).values([
        { pitchId: pitch.id, dayType: "WEEKDAY", pricePerHour: "15.00", depositType: "FIXED", depositAmount: "5.00" },
        { pitchId: pitch.id, dayType: "WEEKEND", pricePerHour: "22.00", depositType: "FIXED", depositAmount: "8.00" },
      ]);
      console.log(`  ✅ Pitch: ${pitch.name}`);
    }

    await db.insert(openingHoursTable).values([
      { venueId: venue3.id, dayOfWeek: 0, openTime: "08:00", closeTime: "22:00", isClosed: false },
      { venueId: venue3.id, dayOfWeek: 1, openTime: "08:00", closeTime: "22:00", isClosed: false },
      { venueId: venue3.id, dayOfWeek: 2, openTime: "08:00", closeTime: "22:00", isClosed: false },
      { venueId: venue3.id, dayOfWeek: 3, openTime: "08:00", closeTime: "22:00", isClosed: false },
      { venueId: venue3.id, dayOfWeek: 4, openTime: "08:00", closeTime: "22:00", isClosed: false },
      { venueId: venue3.id, dayOfWeek: 5, openTime: "08:00", closeTime: "23:00", isClosed: false },
      { venueId: venue3.id, dayOfWeek: 6, openTime: "08:00", closeTime: "23:00", isClosed: false },
    ]);
    console.log("  ✅ Opening hours added");
  } else {
    console.log("ℹ️  Venue 3 already exists, skipping");
  }

  // ─── Venue 4: Paphos Premier Futsal (APPROVED) ───────────────────────────
  const [existingVenue4] = await db
    .select()
    .from(venuesTable)
    .where(eq(venuesTable.name, "Paphos Premier Futsal"))
    .limit(1);

  if (!existingVenue4) {
    const [venue4] = await db
      .insert(venuesTable)
      .values({
        ownerId: owner2Id,
        status: "APPROVED",
        name: "Paphos Premier Futsal",
        district: "Paphos",
        address: "8 Poseidonos Ave, Paphos 8042",
        description:
          "Premium indoor futsal centre with 2 pitches, air conditioning, and a sports bar.",
        amenities: ["Changing Rooms", "Showers", "Air Conditioning", "Sports Bar", "Parking"],
        cancellationWindowHours: 24,
      })
      .returning();

    console.log(`✅ Created venue (APPROVED): ${venue4.name}`);

    const [pitch4a] = await db
      .insert(pitchesTable)
      .values({ venueId: venue4.id, name: "Premium Hall A - 5v5", size: "5v5", type: "INDOOR" as const, slotDurationMinutes: 60 })
      .returning();

    await db.insert(pricingRulesTable).values([
      { pitchId: pitch4a.id, dayType: "WEEKDAY", pricePerHour: "22.00", depositType: "FIXED", depositAmount: "11.00" },
      { pitchId: pitch4a.id, dayType: "WEEKEND", pricePerHour: "30.00", depositType: "FIXED", depositAmount: "15.00" },
    ]);
    console.log(`  ✅ Pitch: ${pitch4a.name}`);

    await db.insert(openingHoursTable).values([
      { venueId: venue4.id, dayOfWeek: 0, openTime: "10:00", closeTime: "21:00", isClosed: false },
      { venueId: venue4.id, dayOfWeek: 1, openTime: "09:00", closeTime: "23:00", isClosed: false },
      { venueId: venue4.id, dayOfWeek: 2, openTime: "09:00", closeTime: "23:00", isClosed: false },
      { venueId: venue4.id, dayOfWeek: 3, openTime: "09:00", closeTime: "23:00", isClosed: false },
      { venueId: venue4.id, dayOfWeek: 4, openTime: "09:00", closeTime: "23:00", isClosed: false },
      { venueId: venue4.id, dayOfWeek: 5, openTime: "09:00", closeTime: "23:00", isClosed: false },
      { venueId: venue4.id, dayOfWeek: 6, openTime: "10:00", closeTime: "22:00", isClosed: false },
    ]);
    console.log("  ✅ Opening hours added");
  } else {
    console.log("ℹ️  Venue 4 already exists, skipping");
  }

  // ─── Venue 5: Famagusta Futsal Club (PENDING - for admin approval testing) ─
  const [existingVenue5] = await db
    .select()
    .from(venuesTable)
    .where(eq(venuesTable.name, "Famagusta Futsal Club"))
    .limit(1);

  if (!existingVenue5) {
    const [venue5] = await db
      .insert(venuesTable)
      .values({
        ownerId: owner2Id,
        status: "PENDING",
        name: "Ayia Napa Futsal Club",
        district: "Ayia Napa",
        address: "3 Salaminos Street, Paralimni 5280",
        description:
          "New community futsal venue in the Ayia Napa area. Awaiting approval.",
        amenities: ["Parking", "Changing Rooms"],
        cancellationWindowHours: 24,
      })
      .returning();

    console.log(`✅ Created venue (PENDING): ${venue5.name}`);

    const [pitch5] = await db
      .insert(pitchesTable)
      .values({ venueId: venue5.id, name: "Main Pitch - 5v5", size: "5v5", type: "INDOOR" as const, slotDurationMinutes: 60 })
      .returning();

    await db.insert(pricingRulesTable).values([
      { pitchId: pitch5.id, dayType: "ALL", pricePerHour: "17.00", depositType: "NONE" },
    ]);
    console.log(`  ✅ Pitch: ${pitch5.name}`);

    await db.insert(openingHoursTable).values([
      { venueId: venue5.id, dayOfWeek: 0, openTime: "09:00", closeTime: "21:00", isClosed: false },
      { venueId: venue5.id, dayOfWeek: 1, openTime: "09:00", closeTime: "21:00", isClosed: false },
      { venueId: venue5.id, dayOfWeek: 2, openTime: "09:00", closeTime: "21:00", isClosed: false },
      { venueId: venue5.id, dayOfWeek: 3, openTime: "09:00", closeTime: "21:00", isClosed: false },
      { venueId: venue5.id, dayOfWeek: 4, openTime: "09:00", closeTime: "21:00", isClosed: false },
      { venueId: venue5.id, dayOfWeek: 5, openTime: "09:00", closeTime: "22:00", isClosed: false },
      { venueId: venue5.id, dayOfWeek: 6, openTime: "09:00", closeTime: "22:00", isClosed: false },
    ]);
    console.log("  ✅ Opening hours added");
  } else {
    console.log("ℹ️  Venue 5 already exists, skipping");
  }

  // ─── Venue 6: Nicosia Pro Arena (REJECTED - for admin testing) ───────────
  const [existingVenue6] = await db
    .select()
    .from(venuesTable)
    .where(eq(venuesTable.name, "Nicosia Pro Arena"))
    .limit(1);

  if (!existingVenue6) {
    const [venue6] = await db
      .insert(venuesTable)
      .values({
        ownerId,
        status: "REJECTED",
        name: "Nicosia Pro Arena",
        district: "Nicosia",
        address: "14 Athalassa Ave, Nicosia 2025",
        description: "Rejected venue for testing purposes.",
        amenities: ["Parking"],
        cancellationWindowHours: 24,
        rejectionReason: "Address could not be verified. Please resubmit with a valid business address.",
      })
      .returning();

    console.log(`✅ Created venue (REJECTED): ${venue6.name}`);
  } else {
    console.log("ℹ️  Venue 6 already exists, skipping");
  }

  await pool.end();

  console.log("\n✅ Seed complete!\n");
  console.log("─────────────────────────────────────────────");
  console.log("Demo credentials:");
  console.log("  PLAYER:       player@futsalcy.com  / Demo1234!");
  console.log("  VENUE_OWNER:  owner@futsalcy.com   / Demo1234!");
  console.log("  VENUE_OWNER2: owner2@futsalcy.com  / Demo1234!");
  console.log("  ADMIN:        admin@futsalcy.com   / Demo1234!");
  console.log("─────────────────────────────────────────────\n");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
