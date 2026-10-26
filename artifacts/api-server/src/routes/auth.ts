import { createHash } from "node:crypto";
import { and, count, eq, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  LoginAccountBody,
  RegisterAdminAccountBody,
  RegisterShopAccountBody,
  RegisterShopAccountResponse,
} from "@workspace/api-zod";
import type { AuthSessionResponse } from "@workspace/api-zod";
import {
  authAccountsTable,
  authSessionsTable,
  db,
  licensesTable,
} from "@workspace/db";
import {
  clearAuthCookie,
  createAuthSession,
  getAuthAccount,
  getSessionToken,
  hashPassword,
  isAllowedAdminEmail,
  isConstantTimeEqual,
  normalizeAccountEmail,
  verifyPassword,
} from "../lib/auth";

const router: IRouter = Router();
const loginAttempts = new Map<string, { count: number; expiresAt: number }>();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 6;
const dummyPasswordHash = hashPassword("not-a-real-account-password-for-timing");
const hashLicenseKey = (key: string) =>
  createHash("sha256").update(key.trim().toUpperCase()).digest("hex");

function isRateLimited(email: string): boolean {
  const now = Date.now();
  for (const [key, attempt] of loginAttempts) {
    if (attempt.expiresAt <= now) loginAttempts.delete(key);
  }
  const existing = loginAttempts.get(email);
  if (!existing || existing.expiresAt <= now) return false;
  return existing.count >= MAX_LOGIN_ATTEMPTS;
}

function recordLoginFailure(email: string): void {
  const existing = loginAttempts.get(email);
  const now = Date.now();
  if (!existing || existing.expiresAt <= now) {
    loginAttempts.set(email, { count: 1, expiresAt: now + LOGIN_WINDOW_MS });
    return;
  }
  existing.count += 1;
}

function clearLoginFailures(email: string): void {
  loginAttempts.delete(email);
}

function toAccountResponse(
  account: {
    email: string;
    role: string;
    deviceId: string | null;
  },
  accessToken: string | null,
) {
  return RegisterShopAccountResponse.parse({
    account: {
      email: account.email,
      role: account.role,
      deviceId: account.deviceId,
      licenseActive: account.role === "shop",
    },
    accessToken,
  });
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "23505",
  );
}

router.post("/auth/shop/register", async (req, res): Promise<void> => {
  const parsed = RegisterShopAccountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid license, email, device, and password (at least 12 characters)." });
    return;
  }
  const email = normalizeAccountEmail(parsed.data.email);
  if (isRateLimited(email)) {
    res.status(429).json({ error: "Too many attempts. Wait 15 minutes and try again." });
    return;
  }
  const passwordHash = await hashPassword(parsed.data.password);

  try {
    const account = await db.transaction(async (tx) => {
      const [license] = await tx
        .select()
        .from(licensesTable)
        .where(eq(licensesTable.keyHash, hashLicenseKey(parsed.data.licenseKey)))
        .for("update")
        .limit(1);
      if (
        !license ||
        license.status !== "active" ||
        normalizeAccountEmail(license.email) !== email ||
        (license.deviceId && license.deviceId !== parsed.data.deviceId)
      ) {
        return { error: "license" as const };
      }

      const existing = await tx
        .select({ id: authAccountsTable.id })
        .from(authAccountsTable)
        .where(
          and(
            eq(authAccountsTable.email, email),
            eq(authAccountsTable.role, "shop"),
          ),
        )
        .limit(1);
      if (existing.length) return { error: "exists" as const };

      const activatedAt = license.activatedAt ?? new Date();
      await tx
        .update(licensesTable)
        .set({ deviceId: parsed.data.deviceId, activatedAt })
        .where(eq(licensesTable.id, license.id));

      const [created] = await tx
        .insert(authAccountsTable)
        .values({
          email,
          passwordHash,
          role: "shop",
          licenseId: license.id,
          deviceId: parsed.data.deviceId,
        })
        .returning({
          id: authAccountsTable.id,
          email: authAccountsTable.email,
          role: authAccountsTable.role,
          deviceId: authAccountsTable.deviceId,
        });
      return { account: created };
    });

    if ("error" in account) {
      recordLoginFailure(email);
      const status = account.error === "exists" ? 409 : 403;
      res.status(status).json({
        error:
          account.error === "exists"
            ? "This email already has a shop account. Sign in instead."
            : "The license, email, or device does not match an active shop license.",
      });
      return;
    }

    const accessToken = await createAuthSession(
      account.account.id,
      account.account.deviceId,
      parsed.data.client,
      res,
    );
    clearLoginFailures(email);
    res.status(201).json(toAccountResponse(account.account, accessToken));
  } catch (error) {
    if (isUniqueViolation(error)) {
      res.status(409).json({ error: "This email or license already has an account. Sign in instead." });
      return;
    }
    req.log.error({ err: error }, "Could not register a shop account");
    res.status(500).json({ error: "The shop account could not be created." });
  }
});

router.post("/auth/admin/register", async (req, res): Promise<void> => {
  const parsed = RegisterAdminAccountBody.safeParse(req.body);
  if (!parsed.success) {
    const invalidField = parsed.error.issues[0]?.path[0];
    const message =
      invalidField === "bootstrapSecret"
        ? "The one-time setup code must be at least 16 characters."
        : invalidField === "password"
          ? "The administrator password must be at least 12 characters."
          : "Enter a valid administrator email.";
    res.status(400).json({ error: message });
    return;
  }
  const email = normalizeAccountEmail(parsed.data.email);
  if (isRateLimited(email)) {
    res.status(429).json({ error: "Too many setup attempts. Wait 15 minutes and try again." });
    return;
  }
  const configuredSecret = process.env.ADMIN_BOOTSTRAP_SECRET;
  if (!configuredSecret) {
    res.status(503).json({ error: "Administrator setup is not configured." });
    return;
  }
  if (
    !isAllowedAdminEmail(email) ||
    !isConstantTimeEqual(parsed.data.bootstrapSecret, configuredSecret)
  ) {
    recordLoginFailure(email);
    res.status(403).json({ error: "The setup code or administrator email is not valid." });
    return;
  }

  try {
    const passwordHash = await hashPassword(parsed.data.password);
    const account = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(61849271)`);
      const [{ value: adminCount }] = await tx
        .select({ value: count() })
        .from(authAccountsTable)
        .where(eq(authAccountsTable.role, "admin"));
      if (Number(adminCount) > 0) return null;
      const [created] = await tx
        .insert(authAccountsTable)
        .values({ email, passwordHash, role: "admin" })
        .returning({
          id: authAccountsTable.id,
          email: authAccountsTable.email,
          role: authAccountsTable.role,
          deviceId: authAccountsTable.deviceId,
        });
      return created;
    });
    if (!account) {
      res.status(409).json({ error: "Administrator setup has already been completed." });
      return;
    }
    const accessToken = await createAuthSession(
      account.id,
      null,
      "browser",
      res,
    );
    res.status(201).json(toAccountResponse(account, accessToken));
  } catch (error) {
    if (isUniqueViolation(error)) {
      res.status(409).json({ error: "This administrator account already exists." });
      return;
    }
    req.log.error({ err: error }, "Could not complete initial administrator setup");
    res.status(500).json({ error: "Administrator setup could not be completed." });
  }
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginAccountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid email and password." });
    return;
  }
  const email = normalizeAccountEmail(parsed.data.email);
  if (isRateLimited(email)) {
    res.status(429).json({ error: "Too many sign-in attempts. Wait 15 minutes and try again." });
    return;
  }

  try {
    const [foundAccount] = await db
      .select()
      .from(authAccountsTable)
      .where(eq(authAccountsTable.email, email))
      .limit(1);
    const fallbackHash = await dummyPasswordHash;
    const passwordValid = await verifyPassword(
      parsed.data.password,
      foundAccount?.passwordHash ?? fallbackHash,
    );
    if (!foundAccount || !passwordValid) {
      recordLoginFailure(email);
      res.status(401).json({ error: "Email or password is incorrect." });
      return;
    }

    let account: NonNullable<typeof foundAccount> = foundAccount;
    if (account.role === "admin") {
      if (parsed.data.client === "desktop") {
        res.status(403).json({ error: "Administrator accounts must sign in through the browser admin portal." });
        return;
      }
      if (!isAllowedAdminEmail(account.email)) {
        res.status(403).json({ error: "Administrator access is not enabled for this account." });
        return;
      }
    } else if (account.role === "shop") {
      if (
        !account.licenseId ||
        !account.deviceId
      ) {
        res.status(403).json({ error: "This shop account belongs to a different licensed installation." });
        return;
      }
      const licenseId = account.licenseId;
      if (parsed.data.client === "desktop") {
        const targetDeviceId = parsed.data.deviceId;
        if (!targetDeviceId) {
          res.status(403).json({ error: "This Windows app is missing its installation ID." });
          return;
        }
        if (account.deviceId !== targetDeviceId) {
          if (!parsed.data.transferInstallation) {
            res.status(409).json({
              error: "This shop account is linked to another installation.",
              code: "SHOP_INSTALLATION_TRANSFER_REQUIRED",
            });
            return;
          }

          const transfer = await db.transaction(async (tx) => {
            const [lockedAccount] = await tx
              .select()
              .from(authAccountsTable)
              .where(eq(authAccountsTable.id, account.id))
              .for("update")
              .limit(1);
            if (
              !lockedAccount ||
              lockedAccount.role !== "shop" ||
              !lockedAccount.licenseId ||
              !lockedAccount.deviceId
            ) {
              return { error: "account" as const };
            }

            const [license] = await tx
              .select()
              .from(licensesTable)
              .where(eq(licensesTable.id, lockedAccount.licenseId))
              .for("update")
              .limit(1);
            if (
              !license ||
              license.status !== "active" ||
              license.deviceId !== lockedAccount.deviceId
            ) {
              return { error: "license" as const };
            }

            await tx
              .update(licensesTable)
              .set({ deviceId: targetDeviceId })
              .where(eq(licensesTable.id, license.id));
            await tx
              .update(authAccountsTable)
              .set({ deviceId: targetDeviceId })
              .where(eq(authAccountsTable.id, lockedAccount.id));
            await tx
              .delete(authSessionsTable)
              .where(eq(authSessionsTable.accountId, lockedAccount.id));

            return {
              account: {
                ...lockedAccount,
                deviceId: targetDeviceId,
              },
            };
          });

          if ("error" in transfer) {
            res.status(403).json({
              error: "This shop license is no longer active on its previous installation.",
            });
            return;
          }
          account = transfer.account;
        }
      }
      const [license] = await db
        .select({ status: licensesTable.status, deviceId: licensesTable.deviceId })
        .from(licensesTable)
        .where(eq(licensesTable.id, licenseId))
        .limit(1);
      if (
        !license ||
        license.status !== "active" ||
        license.deviceId !== account.deviceId
      ) {
        res.status(403).json({ error: "This shop license is no longer active." });
        return;
      }
    } else {
      res.status(403).json({ error: "This account role is not supported." });
      return;
    }

    clearLoginFailures(email);
    const deviceId = account.role === "shop" ? account.deviceId : null;
    const accessToken = await createAuthSession(
      account.id,
      deviceId,
      parsed.data.client,
      res,
    );
    res.json(
      toAccountResponse(
        {
          email: account.email,
          role: account.role,
          deviceId: account.deviceId,
        },
        accessToken,
      ),
    );
  } catch (error) {
    req.log.error({ err: error }, "Could not sign in to the account");
    res.status(500).json({ error: "Sign-in could not be completed." });
  }
});

router.get("/auth/me", async (req, res): Promise<void> => {
  try {
    const account = await getAuthAccount(req);
    if (!account) {
      res.json(RegisterShopAccountResponse.parse({ account: null, accessToken: null }));
      return;
    }
    if (account.role === "shop") {
      if (!account.licenseId || !account.accountDeviceId) {
        res.status(403).json({ error: "This shop account is not linked to a valid installation." });
        return;
      }
      const [license] = await db
        .select({ status: licensesTable.status, deviceId: licensesTable.deviceId })
        .from(licensesTable)
        .where(eq(licensesTable.id, account.licenseId))
        .limit(1);
      if (
        !license ||
        license.status !== "active" ||
        license.deviceId !== account.accountDeviceId
      ) {
        res.status(403).json({ error: "This shop license is no longer active." });
        return;
      }
    }
    res.json(
      toAccountResponse(
        {
          email: account.email,
          role: account.role,
          deviceId: account.accountDeviceId,
        },
        null,
      ),
    );
  } catch (error) {
    req.log.error({ err: error }, "Could not load the signed-in account");
    res.status(500).json({ error: "Account details could not be loaded." });
  }
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  const token = getSessionToken(req);
  if (token) {
    try {
      await db
        .delete(authSessionsTable)
        .where(eq(authSessionsTable.tokenHash, createHash("sha256").update(token).digest("hex")));
    } catch (error) {
      req.log.error({ err: error }, "Could not revoke session token");
      res.status(503).json({ error: "Sign-out could not be confirmed. Try again." });
      return;
    }
  }
  clearAuthCookie(res);
  res.sendStatus(204);
});

export default router;
