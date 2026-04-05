const path = require("path");
const { app, BrowserWindow, ipcMain, shell } = require("electron");

const { getAppConfig } = require("./config.cjs");
const storage = require("./storage/secureStore.cjs");
const { createControlPlaneService } = require("./services/controlPlaneService.cjs");
const { createActivationManager } = require("./services/activationManager.cjs");

const config = getAppConfig();
let mainWindow = null;

const activationManager = createActivationManager({
  config,
  userDataPath: app.getPath("userData"),
  storage,
  controlPlane: createControlPlaneService(config),
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1120,
    minHeight: 700,
    backgroundColor: "#0B1020",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;

  if (devUrl) {
    mainWindow.loadURL(`${devUrl}/electron.html`);
  } else {
    const rendererPath = path.join(__dirname, "..", "dist-electron", "electron.html");
    mainWindow.loadFile(rendererPath);
  }
}

function bindIpc() {
  ipcMain.handle("app:get-config", async () => config);
  ipcMain.handle("license:get-state", async () => activationManager.getState());
  ipcMain.handle("license:activate", async (_event, payload) => activationManager.activate(payload));
  ipcMain.handle("license:restore", async () => activationManager.restore());
  ipcMain.handle("license:heartbeat", async () => activationManager.heartbeat());
  ipcMain.handle("license:deactivate", async () => activationManager.deactivate());
  ipcMain.handle("license:update-device-name", async (_event, deviceName) => activationManager.updateDeviceName(deviceName));
  ipcMain.handle("license:get-safe-context", async () => activationManager.getSafeActivationContext());
  ipcMain.handle("app:open-external", async (_event, url) => {
    if (!url) {
      return false;
    }

    await shell.openExternal(url);
    return true;
  });

  activationManager.onState((nextState) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("license:state-changed", nextState);
    }
  });
}

app.whenReady().then(async () => {
  bindIpc();
  await activationManager.initialize();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  activationManager.stopHeartbeat();
  if (process.platform !== "darwin") {
    app.quit();
  }
});
