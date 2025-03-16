// main.js
// Archivo principal de la aplicación Electron

const { app, ipcMain } = require('electron');
// Importar y configurar @electron/remote
const remoteMain = require('@electron/remote/main');
const WindowManager = require('./src/window-manager');

// Inicializar el módulo remote
remoteMain.initialize();

// Crear el gestor de ventanas
const windowManager = new WindowManager();

function createWindow() {
    windowManager.createMainWindow();
}

// Gestionar eventos IPC
ipcMain.handle('show-conflict-resolution', async (event, data) => {
    return await windowManager.createConflictWindow(data.conflicts, data.modDetails);
});

ipcMain.on('conflict-resolution-completed', (event, data) => {
    windowManager.completeConflictResolution(data);
});

ipcMain.on('conflict-resolution-cancelled', () => {
    windowManager.cancelConflictResolution();
});

// Nuevo evento para manejar solicitudes explícitas de datos
ipcMain.on('request-conflict-data', (event) => {
    if (windowManager.conflictWindow && windowManager.lastConflictData) {
        windowManager.conflictWindow.webContents.send('conflict-data', windowManager.lastConflictData);
    }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (windowManager.mainWindow === null) createWindow();
});