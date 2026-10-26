import {
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const licenseRequestsTable = pgTable("license_requests", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  deviceId: text("device_id").notNull(),
  deviceName: text("device_name").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
});

export const licensesTable = pgTable(
  "licenses",
  {
    id: serial("id").primaryKey(),
    requestId: integer("request_id")
      .notNull()
      .references(() => licenseRequestsTable.id),
    email: text("email").notNull(),
    keyHash: text("key_hash").notNull(),
    encryptedKey: text("encrypted_key"),
    deviceId: text("device_id"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("licenses_key_hash_unique").on(table.keyHash)],
);
