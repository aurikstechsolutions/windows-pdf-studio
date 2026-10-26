const { ImapFlow } = require("imapflow");
const nodemailer = require("nodemailer");
const path = require("node:path");

const MAX_MESSAGES = 50;
const MAX_ATTACHMENT_BYTES = 30 * 1024 * 1024;
const MAX_TEXT_BYTES = 500 * 1024;
const IMAGE_MIME_BY_EXTENSION = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".bmp", "image/bmp"],
  [".tif", "image/tiff"],
  [".tiff", "image/tiff"],
]);
const DEFAULT_EXTENSION_BY_MIME = new Map([
  ["application/pdf", ".pdf"],
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/gif", ".gif"],
  ["image/webp", ".webp"],
  ["image/bmp", ".bmp"],
  ["image/tiff", ".tiff"],
]);

function safeAttachmentName(value, part) {
  const raw = typeof value === "string" && value.trim() ? value : `email-attachment-${part}`;
  const leaf = path.basename(raw).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/[. ]+$/g, "");
  return leaf.slice(0, 180) || `email-attachment-${part}`;
}

function supportedMime(filename, contentType) {
  const extension = path.extname(filename).toLowerCase();
  const mime = String(contentType || "").split(";")[0].trim().toLowerCase();
  if (mime === "application/pdf" || extension === ".pdf") return "application/pdf";
  if (mime.startsWith("image/") && ["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "image/tiff"].includes(mime)) {
    return mime;
  }
  return IMAGE_MIME_BY_EXTENSION.get(extension) || null;
}

function extractSupportedAttachments(structure) {
  const attachments = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    const parameters = node.dispositionParameters || {};
    const contentParameters = node.parameters || {};
    const filename = parameters.filename || parameters.name || contentParameters.name || "";
    const disposition = String(node.disposition || "").toLowerCase();
    const isFilePart = disposition === "attachment" || Boolean(filename);
    if (isFilePart && node.part) {
      const safeName = safeAttachmentName(filename, node.part);
      const mimeType = supportedMime(safeName, node.type);
      const size = Number(node.size) || 0;
      if (mimeType && size <= MAX_ATTACHMENT_BYTES) {
        const name = path.extname(safeName) ? safeName : `${safeName}${DEFAULT_EXTENSION_BY_MIME.get(mimeType)}`;
        attachments.push({ partId: String(node.part), name, mimeType, size });
      }
    }
    for (const child of node.childNodes || []) visit(child);
  };
  visit(structure);
  return attachments;
}

function findPlainTextPart(structure) {
  let found = null;
  const visit = (node) => {
    if (!node || typeof node !== "object" || found) return;
    const filename = node.dispositionParameters?.filename || node.parameters?.name;
    if (!filename && String(node.disposition || "").toLowerCase() !== "attachment" && String(node.type || "").toLowerCase() === "text/plain" && node.part) {
      found = String(node.part);
      return;
    }
    for (const child of node.childNodes || []) visit(child);
  };
  visit(structure);
  return found;
}

function createImapClient(settings) {
  return new ImapFlow({
    host: settings.imapHost,
    port: settings.imapPort,
    secure: settings.imapSecure,
    doSTARTTLS: !settings.imapSecure,
    auth: { user: settings.imapUsername, pass: settings.imapPassword },
    logger: false,
    connectionTimeout: 12000,
    greetingTimeout: 12000,
    socketTimeout: 20000,
    tls: { minVersion: "TLSv1.2" },
  });
}

async function closeImap(client) {
  try {
    if (client && client.usable) await client.logout();
  } catch {
    try { client?.close(); } catch {}
  }
}

function createSmtpTransport(settings) {
  return nodemailer.createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure: settings.smtpSecure,
    requireTLS: !settings.smtpSecure,
    auth: { user: settings.smtpUsername, pass: settings.smtpPassword },
    connectionTimeout: 12000,
    greetingTimeout: 12000,
    socketTimeout: 20000,
    tls: { minVersion: "TLSv1.2" },
  });
}

async function testImap(settings) {
  const client = createImapClient(settings);
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    lock.release();
  } finally {
    await closeImap(client);
  }
}

async function testSmtp(settings) {
  const transport = createSmtpTransport(settings);
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}

async function testConnections(settings) {
  const [imap, smtp] = await Promise.all([
    testImap(settings).then(() => ({ ok: true })).catch(() => ({ ok: false, message: "IMAP could not connect. Check the incoming host, port, security, and credentials." })),
    testSmtp(settings).then(() => ({ ok: true })).catch(() => ({ ok: false, message: "SMTP could not connect. Check the outgoing host, port, security, and credentials." })),
  ]);
  return { imap, smtp, ok: imap.ok && smtp.ok };
}

function formatAddress(address) {
  const name = String(address?.name || "").trim();
  const email = String(address?.address || "").trim();
  if (name && email) return `${name} <${email}>`;
  return email || name || "Unknown sender";
}

async function listMessages(settings) {
  const client = createImapClient(settings);
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const mailbox = client.mailbox;
      const exists = Number(mailbox?.exists || 0);
      if (!exists) return { uidValidity: String(mailbox?.uidValidity || ""), messages: [] };
      const firstSequence = Math.max(1, exists - MAX_MESSAGES + 1);
      const messages = [];
      for await (const item of client.fetch(`${firstSequence}:*`, {
        uid: true,
        envelope: true,
        internalDate: true,
        bodyStructure: true,
        flags: true,
      })) {
        const envelope = item.envelope || {};
        const from = envelope.from?.map(formatAddress).join(", ") || "Unknown sender";
        const received = item.internalDate || envelope.date || null;
        const date = received instanceof Date ? received.getTime() : Date.parse(String(received || ""));
        messages.push({
          uid: item.uid,
          uidValidity: String(mailbox?.uidValidity || ""),
          subject: String(envelope.subject || "(no subject)"),
          from,
          date: Number.isFinite(date) ? date : null,
          unread: !item.flags?.has("\\Seen"),
          attachments: extractSupportedAttachments(item.bodyStructure),
        });
      }
      messages.sort((a, b) => (b.date || 0) - (a.date || 0));
      return { uidValidity: String(mailbox?.uidValidity || ""), messages };
    } finally {
      lock.release();
    }
  } finally {
    await closeImap(client);
  }
}

async function downloadAttachment(settings, request) {
  const uid = Number(request?.uid);
  const uidValidity = String(request?.uidValidity || "");
  const partId = String(request?.partId || "");
  if (!Number.isSafeInteger(uid) || uid < 1 || !/^\d+(?:\.\d+)*$/.test(partId)) {
    throw new Error("The selected attachment is no longer available.");
  }

  const client = createImapClient(settings);
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const mailboxUidValidity = String(client.mailbox?.uidValidity || "");
      if (uidValidity && mailboxUidValidity !== uidValidity) {
        throw new Error("The mailbox changed. Sync the inbox and select the attachment again.");
      }
      const message = await client.fetchOne(String(uid), { uid: true, bodyStructure: true }, { uid: true });
      if (!message || message.uid !== uid) throw new Error("The email could not be found.");
      const attachment = extractSupportedAttachments(message.bodyStructure).find((item) => item.partId === partId);
      if (!attachment) throw new Error("Only PDF and supported image attachments can be imported.");
      if (attachment.size > MAX_ATTACHMENT_BYTES) throw new Error("Attachments must be 30 MB or smaller.");

      const download = await client.download(String(uid), partId, { uid: true, maxBytes: MAX_ATTACHMENT_BYTES });
      if (!download.content) throw new Error("The attachment could not be downloaded.");
      const chunks = [];
      let totalBytes = 0;
      for await (const chunk of download.content) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += buffer.length;
        if (totalBytes > MAX_ATTACHMENT_BYTES) throw new Error("Attachments must be 30 MB or smaller.");
        chunks.push(buffer);
      }
      return {
        name: attachment.name,
        mimeType: attachment.mimeType,
        bytes: new Uint8Array(Buffer.concat(chunks, totalBytes)),
      };
    } finally {
      lock.release();
    }
  } finally {
    await closeImap(client);
  }
}

async function getMessageBody(settings, request) {
  const uid = Number(request?.uid);
  const uidValidity = String(request?.uidValidity || "");
  if (!Number.isSafeInteger(uid) || uid < 1) throw new Error("The selected email is no longer available.");
  const client = createImapClient(settings);
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const mailboxUidValidity = String(client.mailbox?.uidValidity || "");
      if (uidValidity && mailboxUidValidity !== uidValidity) throw new Error("The mailbox changed. Sync the inbox again.");
      const message = await client.fetchOne(String(uid), { uid: true, bodyStructure: true }, { uid: true });
      if (!message || message.uid !== uid) throw new Error("The email could not be found.");
      let markedRead = false;
      try {
        markedRead = await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
      } catch {}
      const partId = findPlainTextPart(message.bodyStructure);
      if (!partId) return { text: "", available: false, markedRead };
      const download = await client.download(String(uid), partId, { uid: true, maxBytes: MAX_TEXT_BYTES });
      if (!download.content) return { text: "", available: false, markedRead };
      const chunks = [];
      let totalBytes = 0;
      for await (const chunk of download.content) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += buffer.length;
        if (totalBytes > MAX_TEXT_BYTES) break;
        chunks.push(buffer);
      }
      const text = Buffer.concat(chunks)
        .toString("utf8")
        .replace(/\u0000/g, "")
        .slice(0, 20000)
        .trim();
      return { text, available: Boolean(text), markedRead };
    } finally {
      lock.release();
    }
  } finally {
    await closeImap(client);
  }
}

module.exports = {
  MAX_ATTACHMENT_BYTES,
  extractSupportedAttachments,
  listMessages,
  getMessageBody,
  downloadAttachment,
  testConnections,
};
