const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopApp", {
  isElectron: true
});

contextBridge.exposeInMainWorld("desktopApi", {
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
  on: (channel, listener) => {
    if (typeof listener !== "function") {
      throw new Error("listener must be a function");
    }

    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on(channel, wrapped);

    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  }
});
