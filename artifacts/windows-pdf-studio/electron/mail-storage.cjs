const fs = require("node:fs/promises");
const path = require("node:path");
const mailService = require("./mail-service.cjs");

const SETTINGS_FILE = "mail-account.secure";

function publicSettings(config) {
  if (!config) return null;
  const { imapPassword, smtpPassword, ...settings } = config;
  return {
    ...settings,
    imapPasswordSaved: Boolean(imapPassword),
    smtpPasswordSaved: Boolean(smtpPassword),
  };
}

function requiredText(value, label, maxLength = 320) {
  const result = String(value || "").trim();
  if (!result || result.length > maxLength) throw new Error(`Enter a valid ${label}.`);
  return result;
}

function normalizePort(value, label) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Enter a valid ${label} port.`);
  return port;
}

function validateConfig(input, previous) {
  const emailAddress = requiredText(input?.emailAddress, "email address", 320);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress)) throw new Error("Enter a valid email address.");
  const imapHost = requiredText(input?.imapHost, "IMAP host", 253);
  const smtpHost = requiredText(input?.smtpHost, "SMTP host", 253);
  if (!/^[A-Za-z0-9.-]+$/.test(imapHost) || !/^[A-Za-z0-9.-]+$/.test(smtpHost)) {
    throw new Error("Enter mail server hostnames without a URL or path.");
  }
  const imapUsername = requiredText(input?.imapUsername, "IMAP username");
  const smtpUsername = requiredText(input?.smtpUsername || input?.imapUsername, "SMTP username");
  const imapPassword = String(input?.imapPassword || previous?.imapPassword || "");
  const smtpPassword = String(input?.smtpPassword || previous?.smtpPassword || "");
  if (!imapPassword || imapPassword.length > 2048) throw new Error("Enter the IMAP password or app password.");
  if (!smtpPassword || smtpPassword.length > 2048) throw new Error("Enter the SMTP password or app password.");
  const displayName = String(input?.displayName || "").trim().slice(0, 120);
  return {
    emailAddress,
    displayName,
    imapHost,
    imapPort: normalizePort(input?.imapPort, "IMAP"),
    imapSecure: input?.imapSecure !== false,
    imapUsername,
    imapPassword,
    smtpHost,
    smtpPort: normalizePort(input?.smtpPort, "SMTP"),
    smtpSecure: input?.smtpSecure !== false,
    smtpUsername,
    smtpPassword,
  };
}

function registerMailIpc({ app, ipcMain, safeStorage }) {
  const settingsPath = path.join(app.getPath("userData"), SETTINGS_FILE);

  async function readConfig() {
    let encrypted;
    try {
      encrypted = await fs.readFile(settingsPath);
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw new Error("Saved mailbox settings could not be read.");
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Windows secure storage is unavailable. Mailbox credentials cannot be loaded safely.");
    }
    try {
      return JSON.parse(safeStorage.decryptString(encrypted));
    } catch (error) {
      throw new Error("Saved mailbox settings could not be unlocked. Reconnect the mailbox in Email settings.");
    }
  }

  async function writeConfig(config) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Windows secure storage is unavailable. Mailbox credentials were not saved.");
    }
    const folder = path.dirname(settingsPath);
    await fs.mkdir(folder, { recursive: true });
    const tempPath = `${settingsPath}.${process.pid}.tmp`;
    const encrypted = safeStorage.encryptString(JSON.stringify(config));
    await fs.writeFile(tempPath, encrypted, { mode: 0o600 });
    await fs.rename(tempPath, settingsPath);
  }

  async function resolveConfig(input) {
    const previous = await readConfig();
    return validateConfig(input || previous, previous);
  }

  ipcMain.handle("mail:get-settings", async () => ({
    secureStorageAvailable: safeStorage.isEncryptionAvailable(),
    settings: publicSettings(await readConfig()),
  }));

  ipcMain.handle("mail:save-settings", async (_event, input) => {
    const config = validateConfig(input, await readConfig());
    await writeConfig(config);
    return publicSettings(config);
  });

  ipcMain.handle("mail:clear-settings", async () => {
    try {
      await fs.unlink(settingsPath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw new Error("The saved mailbox account could not be removed.");
    }
    return true;
  });

  ipcMain.handle("mail:test-connections", async (_event, input) => {
    try {
      const config = await resolveConfig(input);
      return await mailService.testConnections(config);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Check the mailbox settings and try again.";
      return {
        ok: false,
        imap: { ok: false, message },
        smtp: { ok: false, message },
      };
    }
  });

  ipcMain.handle("mail:list-messages", async () => {
    const config = await readConfig();
    if (!config) throw new Error("Connect a mailbox in Email settings first.");
    try {
      return await mailService.listMessages(config);
    } catch {
      throw new Error("The inbox could not be synced. Check the IMAP settings and internet connection.");
    }
  });

  ipcMain.handle("mail:get-message-body", async (_event, request) => {
    const config = await readConfig();
    if (!config) throw new Error("Connect a mailbox in Email settings first.");
    try {
      return await mailService.getMessageBody(config, request);
    } catch {
      throw new Error("The email body could not be loaded. Sync the inbox and try again.");
    }
  });

  ipcMain.handle("mail:get-attachment", async (_event, request) => {
    const config = await readConfig();
    if (!config) throw new Error("Connect a mailbox in Email settings first.");
    try {
      return await mailService.downloadAttachment(config, request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The attachment could not be downloaded.";
      throw new Error(message);
    }
  });
}

module.exports = { registerMailIpc };
