import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import type { Request, RequestHandler, Response } from "express";
import {
  authAccountsTable,
  authSessionsTable,
  db,
  licensesTable,
} from "@workspace/db";

const SESSION_COOKIE = "wps_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_BYTES = 64;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;

export type AuthClient = "browser" | "desktop";
export type AuthRole = "admin" | "shop";

export interface AuthAccount {
  id: string;
  email: string;
  role: string;
  licenseId: number | null;
  accountDeviceId: string | null;
  sessionDeviceId: string | null;
  sessionId: string;
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();
const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

function deriveKey(password: string, salt: Buffer, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      length,
      {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        maxmem: SCRYPT_MAX_MEMORY,
      },
      (error, derived) => {
        if (error) reject(error);
        else resolve(derived);
      },
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await deriveKey(password, salt, SCRYPT_BYTES);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  const [algorithm, n, r, p, saltHex, hashHex] = encodedHash.split("$");
  if (
    algorithm !== "scrypt" ||
    n !== String(SCRYPT_N) ||
    r !== String(SCRYPT_R) ||
    p !== String(SCRYPT_P) ||
    !/^[a-f0-9]{32}$/i.test(saltHex ?? "") ||
    !/^[a-f0-9]{128}$/i.test(hashHex ?? "")
  ) {
    return false;
  }
  const expected = Buffer.from(hashHex, "hex");
  const actual = await deriveKey(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

function getCookieValue(request: Request, name: string): string | null {
  const raw = request.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim()) || null;
    } catch {
      return null;
    }
  }
  return null;
}

export function getSessionToken(request: Request): string | null {
  const authorization = request.get("authorization");
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return bearer || getCookieValue(request, SESSION_COOKIE);
}

export async function getAuthAccount(
  request: Request,
): Promise<AuthAccount | null> {
  const token = getSessionToken(request);
  if (!token) return null;

  const [row] = await db
    .select({
      sessionId: authSessionsTable.id,
      sessionDeviceId: authSessionsTable.deviceId,
      accountId: authAccountsTable.id,
      email: authAccountsTable.email,
      role: authAccountsTable.role,
      licenseId: authAccountsTable.licenseId,
      accountDeviceId: authAccountsTable.deviceId,
    })
    .from(authSessionsTable)
    .innerJoin(
      authAccountsTable,
      eq(authAccountsTable.id, authSessionsTable.accountId),
    )
    .where(
      and(
        eq(authSessionsTable.tokenHash, hashToken(token)),
        gt(authSessionsTable.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return row
    ? {
        id: row.accountId,
        email: row.email,
        role: row.role,
        licenseId: row.licenseId,
        accountDeviceId: row.accountDeviceId,
        sessionDeviceId: row.sessionDeviceId,
        sessionId: row.sessionId,
      }
    : null;
}

export async function createAuthSession(
  accountId: string,
  deviceId: string | null,
  client: AuthClient,
  response: Response,
): Promise<string | null> {
  const token = randomBytes(32).toString("base64url");
  await db.insert(authSessionsTable).values({
    accountId,
    tokenHash: hashToken(token),
    deviceId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });

  if (client === "browser") {
    response.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_MS,
    });
    return null;
  }
  return token;
}

export function clearAuthCookie(response: Response): void {
  response.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
}

export const allowedAdminEmails = () =>
  new Set(
    (process.env.LICENSE_ADMIN_EMAILS ?? "")
      .split(",")
      .map(normalizeEmail)
      .filter(Boolean),
  );

export const isAllowedAdminEmail = (email: string) =>
  allowedAdminEmails().has(normalizeEmail(email));

export const requireAdminAccount: RequestHandler = async (
  request,
  response,
  next,
) => {
  try {
    const account = await getAuthAccount(request);
    if (!account) {
      response.status(401).json({ error: "Sign in to continue." });
      return;
    }
    if (
      account.role !== "admin" ||
      !isAllowedAdminEmail(account.email)
    ) {
      response.status(403).json({ error: "Administrator access is required." });
      return;
    }
    response.locals.authAccount = account;
    next();
  } catch (error) {
    request.log.error({ err: error }, "Could not verify administrator session");
    response.status(503).json({ error: "Administrator access could not be verified." });
  }
};

export const requireShopAccount: RequestHandler = async (
  request,
  response,
  next,
) => {
  try {
    const account = await getAuthAccount(request);
    if (!account) {
      response.status(401).json({ error: "Sign in to this shop to continue." });
      return;
    }
    if (
      account.role !== "shop" ||
      account.licenseId == null ||
      !account.accountDeviceId ||
      account.sessionDeviceId !== account.accountDeviceId
    ) {
      response.status(403).json({ error: "This account is not linked to this shop installation." });
      return;
    }

    const [license] = await db
      .select({
        id: licensesTable.id,
        deviceId: licensesTable.deviceId,
        status: licensesTable.status,
      })
      .from(licensesTable)
      .where(eq(licensesTable.id, account.licenseId))
      .limit(1);
    if (
      !license ||
      license.status !== "active" ||
      license.deviceId !== account.accountDeviceId
    ) {
      response.status(403).json({ error: "This shop license is no longer active." });
      return;
    }

    response.locals.authAccount = account;
    response.locals.printShopLicenseId = license.id;
    next();
  } catch (error) {
    request.log.error({ err: error }, "Could not verify shop account session");
    response.status(503).json({ error: "The shop installation could not be verified right now." });
  }
};

export function isConstantTimeEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

export function normalizeAccountEmail(email: string): string {
  return normalizeEmail(email);
}
