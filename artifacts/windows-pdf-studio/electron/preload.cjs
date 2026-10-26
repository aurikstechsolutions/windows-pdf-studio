const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pdfStudioMail", {
  getSettings: () => ipcRenderer.invoke("mail:get-settings"),
  saveSettings: (settings) => ipcRenderer.invoke("mail:save-settings", settings),
  clearSettings: () => ipcRenderer.invoke("mail:clear-settings"),
  testConnections: (settings) => ipcRenderer.invoke("mail:test-connections", settings),
  listMessages: () => ipcRenderer.invoke("mail:list-messages"),
  getMessageBody: (request) => ipcRenderer.invoke("mail:get-message-body", request),
  getAttachment: (request) => ipcRenderer.invoke("mail:get-attachment", request),
});
