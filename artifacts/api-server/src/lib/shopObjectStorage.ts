import { Storage, type File } from "@google-cloud/storage";

const SIDECAR = "http://127.0.0.1:1106";

const storage = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${SIDECAR}/token`,
    type: "external_account",
    credential_source: {
      url: `${SIDECAR}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

const getPrivateRoot = () => {
  const root = process.env.PRIVATE_OBJECT_DIR?.trim();
  if (!root) throw new Error("Private object storage is not configured.");
  return root.replace(/\/+$/, "");
};

function resolveObject(objectPath: string): File {
  if (!objectPath.startsWith("/objects/")) {
    throw new Error("Invalid private object path.");
  }
  const key = objectPath.slice("/objects/".length);
  if (!key || key.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Invalid private object path.");
  }
  const parts = `${getPrivateRoot()}/${key}`.split("/").filter(Boolean);
  if (parts.length < 2) throw new Error("Invalid private object storage root.");
  const [bucketName, ...objectParts] = parts;
  return storage.bucket(bucketName).file(objectParts.join("/"));
}

export function createShopObjectPath(key: string): string {
  if (!key || key.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Invalid private object key.");
  }
  return `/objects/${key}`;
}

export async function createShopUploadUrl(objectPath: string, ttlSeconds = 900): Promise<string> {
  const file = resolveObject(objectPath);
  const response = await fetch(`${SIDECAR}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: file.bucket.name,
      object_name: file.name,
      method: "PUT",
      expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Could not create a private upload URL (${response.status}).`);
  const result = (await response.json()) as { signed_url?: string };
  if (!result.signed_url) throw new Error("Could not create a private upload URL.");
  return result.signed_url;
}

export async function getShopObjectMetadata(objectPath: string) {
  const file = resolveObject(objectPath);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [metadata] = await file.getMetadata();
  return {
    contentType: metadata.contentType ?? "application/octet-stream",
    sizeBytes: Number(metadata.size ?? 0),
  };
}

export async function readShopObjectPrefix(objectPath: string, length = 16): Promise<Buffer> {
  const file = resolveObject(objectPath);
  const [exists] = await file.exists();
  if (!exists) throw new Error("Private customer file not found.");
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = file.createReadStream({ start: 0, end: Math.max(0, length - 1) });
    stream.on("data", (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks).subarray(0, length)));
  });
}

export async function openShopObject(objectPath: string): Promise<File | null> {
  const file = resolveObject(objectPath);
  const [exists] = await file.exists();
  return exists ? file : null;
}

export async function deleteShopObject(objectPath: string): Promise<void> {
  const file = resolveObject(objectPath);
  await file.delete({ ignoreNotFound: true });
}
