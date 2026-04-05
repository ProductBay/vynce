const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  getConfig: () => ipcRenderer.invoke("app:get-config"),
  openExternal: (url) => ipcRenderer.invoke("app:open-external", url),
  license: {
    getState: () => ipcRenderer.invoke("license:get-state"),
    activate: (payload) => ipcRenderer.invoke("license:activate", payload),
    restore: () => ipcRenderer.invoke("license:restore"),
    heartbeat: () => ipcRenderer.invoke("license:heartbeat"),
    deactivate: () => ipcRenderer.invoke("license:deactivate"),
    updateDeviceName: (deviceName) => ipcRenderer.invoke("license:update-device-name", deviceName),
    getSafeContext: () => ipcRenderer.invoke("license:get-safe-context"),
    onStateChanged: (callback) => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on("license:state-changed", listener);
      return () => ipcRenderer.removeListener("license:state-changed", listener);
    },
  },
});
