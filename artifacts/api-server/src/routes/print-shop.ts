import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, count, desc, eq, gt, inArray, isNull, lt } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler } from "express";
import {
  AcceptPrintShopQuoteParams,
  AcceptPrintShopQuoteResponse,
  CreatePrintShopUploadBody,
  CreatePrintShopUploadParams,
  CreatePrintShopUploadResponse,
  DownloadMyShopRequestFileParams,
  GetMyPrintShopResponse,
  GetPrintShopRequestTrackingParams,
  GetPrintShopRequestTrackingResponse,
  GetPublicPrintShopParams,
  GetPublicPrintShopResponse,
  ListMyShopPrintRequestsQueryParams,
  ListMyShopPrintRequestsResponse,
  SaveMyPrintShopBody,
  SaveMyPrintShopResponse,
  SubmitPrintShopRequestBody,
  SubmitPrintShopRequestParams,
  SubmitPrintShopRequestResponse,
  UpdateMyShopPrintRequestBody,
  UpdateMyShopPrintRequestParams,
  UpdateMyShopPrintRequestResponse,
} from "@workspace/api-zod";
import {
  db,
  licensesTable,
  printShopsTable,
  shopPrintRequestsTable,
  shopRequestEventsTable,
  shopRequestFilesTable,
  shopUploadTicketsTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { requireShopAccount } from "../lib/auth";
import {
  createShopObjectPath,
  createShopUploadUrl,
  deleteShopObject,
  getShopObjectMetadata,
  openShopObject,
  readShopObjectPrefix,
} from "../lib/shopObjectStorage";

const router: IRouter = Router();
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_REQUEST_BYTES = 80 * 1024 * 1024;
const MAX_FILES = 5;
const UPLOAD_TICKET_TTL_MS = 2 * 60 * 60 * 1000;
const REQUEST_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const COMPLETED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const trackingPattern = /^[a-f0-9]{24}$/i;
const rateWindows = new Map<string, { count: number; resetsAt: number }>();

type PrintShopStatus =
  | "received"
  | "quoted"
  | "approved"
  | "printing"
  | "ready"
  | "completed"
  | "cancelled";

const hashLicenseKey = (licenseKey: string) =>
  createHash("sha256").update(licenseKey.trim().toUpperCase()).digest("hex");

const requireInstallation = requireShopAccount;

const getShopForLicense = (licenseId: number) =>
  db
    .select()
    .from(printShopsTable)
    .where(eq(printShopsTable.licenseId, licenseId))
    .limit(1)
    .then(([shop]) => shop ?? null);

const toShopProfile = (shop: NonNullable<Awaited<ReturnType<typeof getShopForLicense>>>) =>
  SaveMyPrintShopResponse.parse({
    id: shop.id,
    shopCode: shop.shopCode,
    shopName: shop.shopName,
    phone: shop.phone,
    whatsappPhone: shop.whatsappPhone,
    address: shop.address,
    city: shop.city,
    acceptingOrders: shop.acceptingOrders,
    bwRatePaise: shop.bwRatePaise,
    colorRatePaise: shop.colorRatePaise,
    createdAt: shop.createdAt.toISOString(),
    updatedAt: shop.updatedAt.toISOString(),
  });

function checkRateLimit(key: string, maximum: number, windowMs: number): boolean {
  const now = Date.now();
  if (rateWindows.size > 2_000) {
    for (const [item, value] of rateWindows) {
      if (value.resetsAt <= now) rateWindows.delete(item);
    }
  }
  const current = rateWindows.get(key);
  if (!current || current.resetsAt <= now) {
    rateWindows.set(key, { count: 1, resetsAt: now + windowMs });
    return true;
  }
  if (current.count >= maximum) return false;
  current.count += 1;
  return true;
}

function detectUploadedMime(prefix: Buffer): string | null {
  const pdfOffset = prefix.indexOf(Buffer.from("%PDF-"));
  if (pdfOffset >= 0 && pdfOffset < 1024) return "application/pdf";
  if (prefix.length >= 3 && prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff) {
    return "image/jpeg";
  }
  if (prefix.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (
    prefix.length >= 12 &&
    prefix.toString("ascii", 0, 4) === "RIFF" &&
    prefix.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function toOwnerRequest(
  request: typeof shopPrintRequestsTable.$inferSelect,
  files: (typeof shopRequestFilesTable.$inferSelect)[],
) {
  return {
    id: request.id,
    trackingCode: request.trackingCode,
    customerName: request.customerName,
    customerPhone: request.customerPhone,
    paperSize: request.paperSize,
    colorMode: request.colorMode,
    sides: request.sides,
    copies: request.copies,
    finishing: request.finishing,
    instructions: request.instructions,
    status: request.status as PrintShopStatus,
    quoteTotalPaise: request.quoteTotalPaise,
    publicMessage: request.publicMessage,
    files: files.map((file) => ({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      pageCount: file.pageCount,
    })),
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
    expiresAt: request.expiresAt.toISOString(),
  };
}

async function buildPublicTracking(trackingCode: string) {
  const [request] = await db
    .select()
    .from(shopPrintRequestsTable)
    .where(
      and(
        eq(shopPrintRequestsTable.trackingCode, trackingCode),
        gt(shopPrintRequestsTable.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!request) return null;

  const [shop] = await db
    .select()
    .from(printShopsTable)
    .where(eq(printShopsTable.id, request.shopId))
    .limit(1);
  if (!shop) return null;

  const [files, events] = await Promise.all([
    db
      .select({ id: shopRequestFilesTable.id })
      .from(shopRequestFilesTable)
      .where(eq(shopRequestFilesTable.requestId, request.id)),
    db
      .select()
      .from(shopRequestEventsTable)
      .where(eq(shopRequestEventsTable.requestId, request.id))
      .orderBy(shopRequestEventsTable.createdAt),
  ]);
  return {
    trackingCode: request.trackingCode,
    shopName: shop.shopName,
    city: shop.city,
    whatsappPhone: shop.whatsappPhone,
    status: request.status as PrintShopStatus,
    paperSize: request.paperSize,
    colorMode: request.colorMode,
    sides: request.sides,
    copies: request.copies,
    finishing: request.finishing,
    quoteTotalPaise: request.quoteTotalPaise,
    publicMessage: request.publicMessage,
    fileCount: files.length,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
    expiresAt: request.expiresAt.toISOString(),
    events: events.map((event) => ({
      status: event.status as PrintShopStatus,
      message: event.message,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

router.get("/shops/me", requireInstallation, async (req, res) => {
  try {
    const shop = await getShopForLicense(res.locals.printShopLicenseId as number);
    res.json(GetMyPrintShopResponse.parse({ shop: shop ? toShopProfile(shop) : null }));
  } catch (error) {
    req.log.error({ err: error }, "Could not load the print-shop profile");
    res.status(500).json({ error: "The shop profile could not be loaded." });
  }
});

router.put("/shops/me", requireInstallation, async (req, res) => {
  const body = SaveMyPrintShopBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Check the shop details and print rates, then try again." });
    return;
  }

  try {
    const licenseId = res.locals.printShopLicenseId as number;
    const current = await getShopForLicense(licenseId);
    const [shop] = current
      ? await db
          .update(printShopsTable)
          .set({ ...body.data, updatedAt: new Date() })
          .where(eq(printShopsTable.id, current.id))
          .returning()
      : await db
          .insert(printShopsTable)
          .values({
            ...body.data,
            licenseId,
            shopCode: randomBytes(12).toString("hex"),
          })
          .returning();
    res.json(toShopProfile(shop));
  } catch (error) {
    req.log.error({ err: error }, "Could not save the print-shop profile");
    res.status(500).json({ error: "The shop profile could not be saved." });
  }
});

router.get("/shops/me/requests", requireInstallation, async (req, res) => {
  const query = ListMyShopPrintRequestsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "The requested page is invalid." });
    return;
  }
  const { page, pageSize } = query.data;
  try {
    const shop = await getShopForLicense(res.locals.printShopLicenseId as number);
    if (!shop) {
      res.json(ListMyShopPrintRequestsResponse.parse({ items: [], page, pageSize, total: 0, totalPages: 0 }));
      return;
    }
    const conditions = and(
      eq(shopPrintRequestsTable.shopId, shop.id),
      gt(shopPrintRequestsTable.expiresAt, new Date()),
      query.data.status ? eq(shopPrintRequestsTable.status, query.data.status) : undefined,
    );
    const [{ value: totalValue }] = await db
      .select({ value: count() })
      .from(shopPrintRequestsTable)
      .where(conditions);
    const total = Number(totalValue);
    const requests = await db
      .select()
      .from(shopPrintRequestsTable)
      .where(conditions)
      .orderBy(desc(shopPrintRequestsTable.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const ids = requests.map((request) => request.id);
    const files = ids.length
      ? await db
          .select()
          .from(shopRequestFilesTable)
          .where(inArray(shopRequestFilesTable.requestId, ids))
      : [];
    const filesByRequest = new Map<string, typeof files>();
    for (const file of files) {
      const group = filesByRequest.get(file.requestId) ?? [];
      group.push(file);
      filesByRequest.set(file.requestId, group);
    }
    res.json(
      ListMyShopPrintRequestsResponse.parse(
        {
          items: requests.map((request) => toOwnerRequest(request, filesByRequest.get(request.id) ?? [])),
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      ),
    );
  } catch (error) {
    req.log.error({ err: error }, "Could not load print-shop requests");
    res.status(500).json({ error: "Customer requests could not be loaded." });
  }
});

router.patch("/shops/me/requests/:requestId", requireInstallation, async (req, res) => {
  const params = UpdateMyShopPrintRequestParams.safeParse(req.params);
  const body = UpdateMyShopPrintRequestBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "The request update is invalid." });
    return;
  }

  try {
    const shop = await getShopForLicense(res.locals.printShopLicenseId as number);
    const [request] = shop
      ? await db
          .select()
          .from(shopPrintRequestsTable)
          .where(
            and(
              eq(shopPrintRequestsTable.id, params.data.requestId),
              eq(shopPrintRequestsTable.shopId, shop.id),
              gt(shopPrintRequestsTable.expiresAt, new Date()),
            ),
          )
          .limit(1)
      : [];
    if (!request) {
      res.status(404).json({ error: "That request is no longer available." });
      return;
    }

    const nextStatus = body.data.status as PrintShopStatus;
    const transitions: Record<PrintShopStatus, PrintShopStatus[]> = {
      received: ["quoted", "cancelled"],
      quoted: ["cancelled"],
      approved: ["printing", "cancelled"],
      printing: ["ready", "cancelled"],
      ready: ["completed", "printing"],
      completed: [],
      cancelled: [],
    };
    if (nextStatus !== request.status && !transitions[request.status as PrintShopStatus]?.includes(nextStatus)) {
      res.status(409).json({ error: "This request cannot move to that status." });
      return;
    }
    if (nextStatus === "quoted" && body.data.quoteTotalPaise == null) {
      res.status(400).json({ error: "Enter a customer price before sharing it." });
      return;
    }

    const now = new Date();
    const expiry = nextStatus === "completed"
      ? new Date(Math.min(request.createdAt.getTime() + REQUEST_RETENTION_MS, now.getTime() + COMPLETED_RETENTION_MS))
      : request.expiresAt;
    const [updated] = await db
      .update(shopPrintRequestsTable)
      .set({
        status: nextStatus,
        quoteTotalPaise:
          body.data.quoteTotalPaise === undefined
            ? request.quoteTotalPaise
            : body.data.quoteTotalPaise,
        publicMessage:
          body.data.publicMessage === undefined
            ? request.publicMessage
            : body.data.publicMessage,
        updatedAt: now,
        expiresAt: expiry,
      })
      .where(eq(shopPrintRequestsTable.id, request.id))
      .returning();
    await db.insert(shopRequestEventsTable).values({
      requestId: request.id,
      status: nextStatus,
      message: body.data.publicMessage === undefined ? updated.publicMessage : body.data.publicMessage,
    });
    const files = await db
      .select()
      .from(shopRequestFilesTable)
      .where(eq(shopRequestFilesTable.requestId, request.id));
    res.json(UpdateMyShopPrintRequestResponse.parse(toOwnerRequest(updated, files)));
  } catch (error) {
    req.log.error({ err: error }, "Could not update print request");
    res.status(500).json({ error: "The request could not be updated." });
  }
});

router.get(
  "/shops/me/requests/:requestId/files/:fileId",
  requireInstallation,
  async (req, res) => {
    const params = DownloadMyShopRequestFileParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "The file reference is invalid." });
      return;
    }
    try {
      const shop = await getShopForLicense(res.locals.printShopLicenseId as number);
      const [row] = shop
        ? await db
            .select({ file: shopRequestFilesTable, request: shopPrintRequestsTable })
            .from(shopRequestFilesTable)
            .innerJoin(
              shopPrintRequestsTable,
              eq(shopRequestFilesTable.requestId, shopPrintRequestsTable.id),
            )
            .where(
              and(
                eq(shopRequestFilesTable.id, params.data.fileId),
                eq(shopRequestFilesTable.requestId, params.data.requestId),
                eq(shopPrintRequestsTable.shopId, shop.id),
                gt(shopPrintRequestsTable.expiresAt, new Date()),
              ),
            )
            .limit(1)
        : [];
      if (!row) {
        res.status(404).json({ error: "That file is no longer available." });
        return;
      }
      const file = await openShopObject(row.file.objectPath);
      if (!file) {
        res.status(404).json({ error: "That file is no longer available." });
        return;
      }
      const [metadata] = await file.getMetadata();
      const safeName = row.file.name.replace(/[\r\n"]/g, "_");
      res.setHeader("Content-Type", row.file.mimeType);
      res.setHeader("Content-Length", String(metadata.size ?? row.file.sizeBytes));
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`);
      res.setHeader("Cache-Control", "private, no-store");
      file.createReadStream().on("error", (error) => {
        req.log.error({ err: error }, "Could not stream customer file");
        if (!res.headersSent) res.status(500).end();
        else res.destroy(error);
      }).pipe(res);
    } catch (error) {
      req.log.error({ err: error }, "Could not open customer file");
      if (!res.headersSent) res.status(500).json({ error: "The file could not be opened." });
    }
  },
);

router.get("/shops/public/:shopCode", async (req, res) => {
  const params = GetPublicPrintShopParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "This shop QR code is not valid." });
    return;
  }
  try {
    const [shop] = await db
      .select()
      .from(printShopsTable)
      .where(eq(printShopsTable.shopCode, params.data.shopCode))
      .limit(1);
    if (!shop) {
      res.status(404).json({ error: "This shop QR code could not be found." });
      return;
    }
    res.json(
      GetPublicPrintShopResponse.parse({
        shopCode: shop.shopCode,
        shopName: shop.shopName,
        phone: shop.phone,
        whatsappPhone: shop.whatsappPhone,
        address: shop.address,
        city: shop.city,
        acceptingOrders: shop.acceptingOrders,
        bwRatePaise: shop.bwRatePaise,
        colorRatePaise: shop.colorRatePaise,
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Could not load public print-shop profile");
    res.status(500).json({ error: "Shop details could not be loaded." });
  }
});

router.post("/shops/public/:shopCode/upload-url", async (req, res) => {
  const params = CreatePrintShopUploadParams.safeParse(req.params);
  const body = CreatePrintShopUploadBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Choose a supported PDF or image under 25 MB." });
    return;
  }
  const ip = req.ip ?? "unknown";
  if (!checkRateLimit(`upload:${params.data.shopCode}:${ip}`, 15, 60 * 60 * 1000)) {
    res.status(429).json({ error: "Too many upload attempts. Please try again later." });
    return;
  }
  try {
    const [shop] = await db
      .select()
      .from(printShopsTable)
      .where(eq(printShopsTable.shopCode, params.data.shopCode))
      .limit(1);
    if (!shop) {
      res.status(404).json({ error: "This shop QR code could not be found." });
      return;
    }
    if (!shop.acceptingOrders) {
      res.status(409).json({ error: "This shop is not accepting print requests right now." });
      return;
    }
    const ticketId = randomUUID();
    const objectPath = createShopObjectPath(`shop-intake/${shop.id}/${ticketId}`);
    const expiresAt = new Date(Date.now() + UPLOAD_TICKET_TTL_MS);
    await db.insert(shopUploadTicketsTable).values({
      id: ticketId,
      shopId: shop.id,
      objectPath,
      name: body.data.name,
      mimeType: body.data.contentType,
      sizeBytes: body.data.sizeBytes,
      pageCount: body.data.pageCount,
      expiresAt,
    });
    try {
      const uploadUrl = await createShopUploadUrl(objectPath);
      res.status(201).json(
        CreatePrintShopUploadResponse.parse({
          ticketId,
          uploadUrl,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        }),
      );
    } catch (error) {
      await db.delete(shopUploadTicketsTable).where(eq(shopUploadTicketsTable.id, ticketId));
      throw error;
    }
  } catch (error) {
    req.log.error({ err: error }, "Could not prepare private customer upload");
    res.status(503).json({ error: "A secure upload could not be prepared. Please try again." });
  }
});

router.post("/shops/public/:shopCode/requests", async (req, res) => {
  const params = SubmitPrintShopRequestParams.safeParse(req.params);
  const body = SubmitPrintShopRequestBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Check the request details and print settings." });
    return;
  }
  const ip = req.ip ?? "unknown";
  if (!checkRateLimit(`submit:${params.data.shopCode}:${ip}`, 10, 60 * 60 * 1000)) {
    res.status(429).json({ error: "Too many requests. Please try again later." });
    return;
  }
  if (new Set(body.data.uploadTicketIds).size !== body.data.uploadTicketIds.length) {
    res.status(400).json({ error: "A file was selected more than once." });
    return;
  }
  try {
    const [shop] = await db
      .select()
      .from(printShopsTable)
      .where(eq(printShopsTable.shopCode, params.data.shopCode))
      .limit(1);
    if (!shop) {
      res.status(404).json({ error: "This shop QR code could not be found." });
      return;
    }
    if (!shop.acceptingOrders) {
      res.status(409).json({ error: "This shop is not accepting print requests right now." });
      return;
    }
    const tickets = await db
      .select()
      .from(shopUploadTicketsTable)
      .where(
        and(
          eq(shopUploadTicketsTable.shopId, shop.id),
          inArray(shopUploadTicketsTable.id, body.data.uploadTicketIds),
          gt(shopUploadTicketsTable.expiresAt, new Date()),
        ),
      );
    if (tickets.length !== body.data.uploadTicketIds.length || tickets.some((ticket) => ticket.consumedAt)) {
      res.status(409).json({ error: "One or more uploads expired. Please upload the files again." });
      return;
    }
    const totalBytes = tickets.reduce((total, ticket) => total + ticket.sizeBytes, 0);
    if (totalBytes > MAX_REQUEST_BYTES) {
      res.status(400).json({ error: "The combined files are larger than the 80 MB request limit." });
      return;
    }

    for (const ticket of tickets) {
      if (ticket.sizeBytes > MAX_FILE_BYTES) {
        res.status(400).json({ error: "Each file must be 25 MB or smaller." });
        return;
      }
      const metadata = await getShopObjectMetadata(ticket.objectPath);
      if (!metadata || metadata.sizeBytes !== ticket.sizeBytes || metadata.sizeBytes > MAX_FILE_BYTES) {
        res.status(400).json({ error: `The upload for “${ticket.name}” is incomplete or has an unexpected size.` });
        return;
      }
      const prefix = await readShopObjectPrefix(ticket.objectPath, 1024);
      const actualMime = detectUploadedMime(prefix);
      if (!actualMime || actualMime !== ticket.mimeType) {
        res.status(400).json({ error: `The file “${ticket.name}” does not match its selected file type.` });
        return;
      }
    }

    const trackingCode = randomBytes(12).toString("hex");
    const createdAt = new Date();
    const estimatedPageCount = tickets.reduce((sum, ticket) => sum + ticket.pageCount, 0);
    const unitPrice = body.data.colorMode === "color" ? shop.colorRatePaise : shop.bwRatePaise;
    const estimatedTotalPaise = estimatedPageCount * body.data.copies * unitPrice;
    const priceMessage = "Price calculated from the shop’s posted page rates. Review and accept it to confirm printing.";
    const expiresAt = new Date(createdAt.getTime() + REQUEST_RETENTION_MS);
    const customerName = body.data.customerName.trim();
    const customerPhone = body.data.customerPhone?.trim() || null;
    const instructions = body.data.instructions.trim();

    await db.transaction(async (tx) => {
      const consumed = await tx
        .update(shopUploadTicketsTable)
        .set({ consumedAt: createdAt })
        .where(
          and(
            eq(shopUploadTicketsTable.shopId, shop.id),
            inArray(shopUploadTicketsTable.id, body.data.uploadTicketIds),
            isNull(shopUploadTicketsTable.consumedAt),
            gt(shopUploadTicketsTable.expiresAt, createdAt),
          ),
        )
        .returning({ id: shopUploadTicketsTable.id });
      if (consumed.length !== tickets.length) throw new Error("UPLOAD_TICKET_ALREADY_USED");

      const [request] = await tx
        .insert(shopPrintRequestsTable)
        .values({
          shopId: shop.id,
          trackingCode,
          customerName,
          customerPhone,
          paperSize: body.data.paperSize,
          colorMode: body.data.colorMode,
          sides: body.data.sides,
          copies: body.data.copies,
          finishing: body.data.finishing,
          instructions,
          status: "quoted",
          quoteTotalPaise: estimatedTotalPaise,
          publicMessage: priceMessage,
          createdAt,
          updatedAt: createdAt,
          expiresAt,
        })
        .returning();
      await tx.insert(shopRequestFilesTable).values(
        tickets.map((ticket) => ({
          requestId: request.id,
          objectPath: ticket.objectPath,
          name: ticket.name,
          mimeType: ticket.mimeType,
          sizeBytes: ticket.sizeBytes,
          pageCount: ticket.pageCount,
        })),
      );
      await tx.insert(shopRequestEventsTable).values({
        requestId: request.id,
        status: "quoted",
        message: priceMessage,
        createdAt,
      });
      await tx
        .delete(shopUploadTicketsTable)
        .where(inArray(shopUploadTicketsTable.id, body.data.uploadTicketIds));
    });

    res.status(201).json(
      SubmitPrintShopRequestResponse.parse({
        trackingCode,
        shopName: shop.shopName,
        status: "quoted",
        estimatedTotalPaise,
        fileCount: tickets.length,
        expiresAt: expiresAt.toISOString(),
      }),
    );
  } catch (error) {
    if (error instanceof Error && error.message === "UPLOAD_TICKET_ALREADY_USED") {
      res.status(409).json({ error: "A selected upload was already submitted. Please upload again." });
      return;
    }
    req.log.error({ err: error }, "Could not submit separate customer print request");
    res.status(500).json({ error: "The print request could not be submitted." });
  }
});

router.get("/shops/track/:trackingCode", async (req, res) => {
  const params = GetPrintShopRequestTrackingParams.safeParse(req.params);
  if (!params.success || !trackingPattern.test(params.data.trackingCode)) {
    res.status(404).json({ error: "This tracking code could not be found." });
    return;
  }
  try {
    const tracking = await buildPublicTracking(params.data.trackingCode);
    if (!tracking) {
      res.status(404).json({ error: "This request has expired or the tracking code is incorrect." });
      return;
    }
    res.json(GetPrintShopRequestTrackingResponse.parse(tracking));
  } catch (error) {
    req.log.error({ err: error }, "Could not load public print request tracking");
    res.status(500).json({ error: "Request status could not be loaded." });
  }
});

router.post("/shops/track/:trackingCode/accept-quote", async (req, res) => {
  const params = AcceptPrintShopQuoteParams.safeParse(req.params);
  if (!params.success || !trackingPattern.test(params.data.trackingCode)) {
    res.status(404).json({ error: "This tracking code could not be found." });
    return;
  }
  try {
    const [updated] = await db
      .update(shopPrintRequestsTable)
      .set({
        status: "approved",
        publicMessage: "Price accepted. The shop can begin printing.",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(shopPrintRequestsTable.trackingCode, params.data.trackingCode),
          eq(shopPrintRequestsTable.status, "quoted"),
          gt(shopPrintRequestsTable.expiresAt, new Date()),
        ),
      )
      .returning();
    if (!updated) {
      res.status(409).json({ error: "This request is not waiting for price approval." });
      return;
    }
    await db.insert(shopRequestEventsTable).values({
      requestId: updated.id,
      status: "approved",
      message: "Price accepted. The shop can begin printing.",
    });
    const tracking = await buildPublicTracking(updated.trackingCode);
    res.json(AcceptPrintShopQuoteResponse.parse(tracking));
  } catch (error) {
    req.log.error({ err: error }, "Could not accept print request price");
    res.status(500).json({ error: "The price could not be accepted." });
  }
});

async function cleanExpiredShopDocuments(): Promise<void> {
  const now = new Date();
  const expiredRequests = await db
    .select()
    .from(shopPrintRequestsTable)
    .where(lt(shopPrintRequestsTable.expiresAt, now));
  for (const request of expiredRequests) {
    try {
      const files = await db
        .select()
        .from(shopRequestFilesTable)
        .where(eq(shopRequestFilesTable.requestId, request.id));
      for (const file of files) await deleteShopObject(file.objectPath);
      await db.delete(shopPrintRequestsTable).where(eq(shopPrintRequestsTable.id, request.id));
    } catch (error) {
      logger.error({ err: error, requestId: request.id }, "Could not expire print-shop request files");
    }
  }

  const expiredTickets = await db
    .select()
    .from(shopUploadTicketsTable)
    .where(lt(shopUploadTicketsTable.expiresAt, now));
  for (const ticket of expiredTickets) {
    try {
      await deleteShopObject(ticket.objectPath);
      await db.delete(shopUploadTicketsTable).where(eq(shopUploadTicketsTable.id, ticket.id));
    } catch (error) {
      logger.error({ err: error, ticketId: ticket.id }, "Could not expire incomplete customer upload");
    }
  }
}

const retentionTimer = setInterval(() => {
  void cleanExpiredShopDocuments().catch((error) => {
    logger.error({ err: error }, "Print-shop retention cleanup failed");
  });
}, 60 * 60 * 1000);
retentionTimer.unref();
void cleanExpiredShopDocuments().catch((error) => {
  logger.error({ err: error }, "Initial print-shop retention cleanup failed");
});

export default router;
