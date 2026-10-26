import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { licensesTable } from "./licensing";

export const authAccountsTable = pgTable(
  "auth_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull(),
    licenseId: integer("license_id").references(() => licensesTable.id, { onDelete: "cascade" }),
    deviceId: text("device_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("auth_accounts_email_unique").on(table.email),
    uniqueIndex("auth_accounts_license_unique").on(table.licenseId),
  ],
);

export const authSessionsTable = pgTable(
  "auth_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").notNull().references(() => authAccountsTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    deviceId: text("device_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("auth_sessions_token_hash_unique").on(table.tokenHash),
    index("auth_sessions_account_idx").on(table.accountId),
    index("auth_sessions_expiry_idx").on(table.expiresAt),
  ],
);
