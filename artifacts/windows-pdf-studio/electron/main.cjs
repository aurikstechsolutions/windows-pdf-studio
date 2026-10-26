const { app, BrowserWindow, shell, ipcMain, safeStorage } = require("electron");
const path = require("node:path");
const { registerMailIpc } = require("./mail-storage.cjs");

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 980,
    minHeight: 700,
    backgroundColor: "#eef2f4",
    autoHideMenuBar: true,
    title: "Windows PDF Studio",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });

  void window.loadFile(path.join(__dirname, "../dist/public/index.html"), {
    hash: "/",
  });
}

app.whenReady().then(() => {
  registerMailIpc({ app, ipcMain, safeStorage });
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
