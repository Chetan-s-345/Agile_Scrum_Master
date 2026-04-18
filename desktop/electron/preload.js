const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopApp", {
  isElectron: true
});

contextBridge.exposeInMainWorld("desktopApi", {
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload)
});
