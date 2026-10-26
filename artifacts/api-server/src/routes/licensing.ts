import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  ActivateLicenseBody,
  CreateLicenseRequestBody,
  GetLicenseStatusQueryParams,
  ListLicenseRequestsResponse,
  ReviewLicenseRequestBody,
  ReviewLicenseRequestParams,
  ReviewLicenseRequestResponse,
} from "@workspace/api-zod";
import { db, licenseRequestsTable, licensesTable } from "@workspace/db";
import { requireAdminAccount } from "../lib/auth";

const router: IRouter = Router();

const toRequestDto = (
  request: typeof licenseRequestsTable.$inferSelect,
 ) => ({
  ...request,
  createdAt: request.createdAt.toISOString(),
  reviewedAt: request.reviewedAt?.toISOString() ?? null,
  status: request.status as "pending" | "approved" | "declined",
});

const hashLicenseKey = (licenseKey: string) =>
  createHash("sha256").update(licenseKey.trim().toUpperCase()).digest("hex");

const licenseKeyEncryptionKey = () => {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is required to encrypt issued license keys.");
  }
  return createHash("sha256")
    .update("windows-pdf-studio:license-key-encryption:v1:")
    .update(secret)
    .digest();
};

const encryptLicenseKey = (licenseKey: string) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", licenseKeyEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(licenseKey, "utf8"),
    cipher.final(),
  ]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
};

const decryptLicenseKey = (encryptedKey: string) => {
  const [version, encodedIv, encodedTag, encodedCiphertext] = encryptedKey.split(".");
  if (version !== "v1" || !encodedIv || !encodedTag || !encodedCiphertext) {
    throw new Error("The stored license key has an unsupported format.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    licenseKeyEncryptionKey(),
    Buffer.from(encodedIv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
};

const makeLicenseKey = () =>
  `PDFS-${randomBytes(20).toString("hex").toUpperCase()}`;

router.get("/license-requests", requireAdminAccount, async (req, res) => {
  try {
    const rows = await db
      .select({
        request: licenseRequestsTable,
        encryptedKey: licensesTable.encryptedKey,
      })
      .from(licenseRequestsTable)
      .leftJoin(
        licensesTable,
        eq(licensesTable.requestId, licenseRequestsTable.id),
      )
      .orderBy(desc(licenseRequestsTable.createdAt));
    res.json(ListLicenseRequestsResponse.parse(rows.map(({ request, encryptedKey }) => ({
      ...toRequestDto(request),
      licenseKey: encryptedKey ? decryptLicenseKey(encryptedKey) : null,
    }))));
  } catch (error) {
    req.log.error({ err: error }, "Could not list license requests");
    res.status(500).json({ error: "License requests could not be loaded." });
  }
});

router.post("/license-requests", async (req, res) => {
  const parsed = CreateLicenseRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid name, email, and device." });
    return;
  }

  try {
    const existing = await db
      .select({ id: licenseRequestsTable.id })
      .from(licenseRequestsTable)
      .where(
        and(
          eq(licenseRequestsTable.deviceId, parsed.data.deviceId),
          eq(licenseRequestsTable.status, "pending"),
        ),
      )
      .limit(1);

    if (existing.length) {
      res.status(409).json({ error: "A request for this device is already pending." });
      return;
    }

    const [created] = await db
      .insert(licenseRequestsTable)
      .values(parsed.data)
      .returning();
    res.status(201).json(toRequestDto(created));
  } catch (error) {
    req.log.error({ err: error }, "Could not create license request");
    res.status(500).json({ error: "Your license request could not be submitted." });
  }
});

router.patch("/license-requests/:requestId", requireAdminAccount, async (req, res) => {
  const params = ReviewLicenseRequestParams.safeParse(req.params);
  const body = ReviewLicenseRequestBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "The review request is invalid." });
    return;
  }

  try {
    const [updated] = await db.transaction(async (tx) => {
      const [request] = await tx
        .update(licenseRequestsTable)
        .set({
          status: body.data.decision === "approve" ? "approved" : "declined",
          reviewedAt: new Date(),
        })
        .where(
          and(
            eq(licenseRequestsTable.id, params.data.requestId),
            eq(licenseRequestsTable.status, "pending"),
          ),
        )
        .returning();
      if (!request) return [];

      const licenseKey =
        body.data.decision === "approve" ? makeLicenseKey() : null;
      if (licenseKey) {
        await tx.insert(licensesTable).values({
          requestId: request.id,
          email: request.email,
          keyHash: hashLicenseKey(licenseKey),
          encryptedKey: encryptLicenseKey(licenseKey),
        });
      }
      return [{ request, licenseKey }];
    });

    if (!updated) {
      const [existing] = await db
        .select({ id: licenseRequestsTable.id })
        .from(licenseRequestsTable)
        .where(eq(licenseRequestsTable.id, params.data.requestId))
        .limit(1);
      res
        .status(existing ? 409 : 404)
        .json({ error: existing ? "This request has already been reviewed." : "Request not found." });
      return;
    }

    res.json(
      ReviewLicenseRequestResponse.parse({
        request: toRequestDto(updated.request),
        licenseKey: updated.licenseKey,
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Could not review license request");
    res.status(500).json({ error: "The license request could not be reviewed." });
  }
});

router.post("/licenses/activate", async (req, res) => {
  const parsed = ActivateLicenseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid license key." });
    return;
  }

  try {
    const [license] = await db
      .select()
      .from(licensesTable)
      .where(eq(licensesTable.keyHash, hashLicenseKey(parsed.data.licenseKey)))
      .limit(1);

    if (!license || license.status !== "active") {
      res.status(403).json({ error: "This license key is invalid or inactive." });
      return;
    }
    if (license.deviceId && license.deviceId !== parsed.data.deviceId) {
      res.status(403).json({ error: "This license is already assigned to another device." });
      return;
    }

    const activatedAt = license.activatedAt ?? new Date();
    const [activated] = await db
      .update(licensesTable)
      .set({ deviceId: parsed.data.deviceId, activatedAt })
      .where(eq(licensesTable.id, license.id))
      .returning();
    res.json({
      active: true,
      email: activated.email,
      deviceId: parsed.data.deviceId,
      activatedAt: activated.activatedAt?.toISOString() ?? null,
    });
  } catch (error) {
    req.log.error({ err: error }, "Could not activate license");
    res.status(500).json({ error: "The license could not be activated." });
  }
});

router.get("/licenses/status", async (req, res) => {
  const parsed = GetLicenseStatusQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "A device ID and license key are required." });
    return;
  }

  try {
    const [license] = await db
      .select()
      .from(licensesTable)
      .where(eq(licensesTable.keyHash, hashLicenseKey(parsed.data.licenseKey)))
      .limit(1);
    if (
      !license ||
      license.status !== "active" ||
      license.deviceId !== parsed.data.deviceId
    ) {
      res.status(403).json({ error: "This license is not active on this device." });
      return;
    }
    res.json({
      active: true,
      email: license.email,
      deviceId: license.deviceId,
      activatedAt: license.activatedAt?.toISOString() ?? null,
    });
  } catch (error) {
    req.log.error({ err: error }, "Could not check license status");
    res.status(500).json({ error: "License status could not be checked." });
  }
});

export default router;
