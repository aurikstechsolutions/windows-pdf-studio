import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { licensesTable } from "./licensing";

export const printShopsTable = pgTable(
  "print_shops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    licenseId: integer("license_id")
      .notNull()
      .references(() => licensesTable.id, { onDelete: "cascade" }),
    shopCode: text("shop_code").notNull(),
    shopName: text("shop_name").notNull(),
    phone: text("phone").notNull(),
    whatsappPhone: text("whatsapp_phone").notNull(),
    address: text("address").notNull().default(""),
    city: text("city").notNull(),
    acceptingOrders: boolean("accepting_orders").notNull().default(true),
    bwRatePaise: integer("bw_rate_paise").notNull().default(200),
    colorRatePaise: integer("color_rate_paise").notNull().default(1000),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("print_shops_license_unique").on(table.licenseId),
    uniqueIndex("print_shops_code_unique").on(table.shopCode),
  ],
);

export const shopUploadTicketsTable = pgTable(
  "shop_upload_tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id").notNull().references(() => printShopsTable.id, { onDelete: "cascade" }),
    objectPath: text("object_path").notNull(),
    name: text("name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    pageCount: integer("page_count").notNull().default(1),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("shop_upload_tickets_expiry_idx").on(table.expiresAt)],
);

export const shopPrintRequestsTable = pgTable(
  "shop_print_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id").notNull().references(() => printShopsTable.id, { onDelete: "cascade" }),
    trackingCode: text("tracking_code").notNull(),
    customerName: text("customer_name").notNull(),
    customerPhone: text("customer_phone"),
    paperSize: text("paper_size").notNull(),
    colorMode: text("color_mode").notNull(),
    sides: text("sides").notNull(),
    copies: integer("copies").notNull(),
    finishing: text("finishing").notNull().default("none"),
    instructions: text("instructions").notNull().default(""),
    status: text("status").notNull().default("received"),
    quoteTotalPaise: integer("quote_total_paise"),
    publicMessage: text("public_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("shop_print_requests_tracking_unique").on(table.trackingCode),
    index("shop_print_requests_shop_created_idx").on(table.shopId, table.createdAt),
    index("shop_print_requests_expiry_idx").on(table.expiresAt),
  ],
);

export const shopRequestFilesTable = pgTable(
  "shop_request_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id").notNull().references(() => shopPrintRequestsTable.id, { onDelete: "cascade" }),
    objectPath: text("object_path").notNull(),
    name: text("name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    pageCount: integer("page_count").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("shop_request_files_request_idx").on(table.requestId)],
);

export const shopRequestEventsTable = pgTable(
  "shop_request_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id").notNull().references(() => shopPrintRequestsTable.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    message: text("message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("shop_request_events_request_idx").on(table.requestId, table.createdAt)],
);

export const insertPrintShopSchema = createInsertSchema(printShopsTable)
  .omit({ id: true, licenseId: true, shopCode: true, createdAt: true, updatedAt: true });
export const insertShopUploadTicketSchema = createInsertSchema(shopUploadTicketsTable)
  .omit({ id: true, shopId: true, createdAt: true, expiresAt: true, consumedAt: true });
export const insertShopPrintRequestSchema = createInsertSchema(shopPrintRequestsTable)
  .omit({ id: true, shopId: true, trackingCode: true, status: true, createdAt: true, updatedAt: true, expiresAt: true });
export const insertShopRequestFileSchema = createInsertSchema(shopRequestFilesTable)
  .omit({ id: true, requestId: true, createdAt: true });
export const insertShopRequestEventSchema = createInsertSchema(shopRequestEventsTable)
  .omit({ id: true, requestId: true, createdAt: true });

export type InsertPrintShop = z.infer<typeof insertPrintShopSchema>;
export type PrintShop = typeof printShopsTable.$inferSelect;
export type InsertShopUploadTicket = z.infer<typeof insertShopUploadTicketSchema>;
export type ShopUploadTicket = typeof shopUploadTicketsTable.$inferSelect;
export type InsertShopPrintRequest = z.infer<typeof insertShopPrintRequestSchema>;
export type ShopPrintRequest = typeof shopPrintRequestsTable.$inferSelect;
export type InsertShopRequestFile = z.infer<typeof insertShopRequestFileSchema>;
export type ShopRequestFile = typeof shopRequestFilesTable.$inferSelect;
export type InsertShopRequestEvent = z.infer<typeof insertShopRequestEventSchema>;
export type ShopRequestEvent = typeof shopRequestEventsTable.$inferSelect;
