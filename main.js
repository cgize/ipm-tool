// main.js
// Archivo principal de la aplicación Electron

const { app, ipcMain } = require('electron');
// Importar y configurar @electron/remote
const remoteMain = require('@electron/remote/main');
const WindowManager = require('./src/window-manager');
const config = require('./src/config');

// Inicializar el módulo remote
remoteMain.initialize();

// Crear el gestor de ventanas
const windowManager = new WindowManager();

/**
 * Crea la ventana principal de la aplicación
 */
function createWindow() {
    windowManager.createMainWindow();
}

// Gestionar eventos IPC
/**
 * Maneja la solicitud para mostrar la ventana de resolución de conflictos
 */
ipcMain.handle('show-conflict-resolution', async (event, data) => {
    return await windowManager.createConflictWindow(data.conflicts, data.modDetails);
});

/**
 * Recibe la notificación de que la resolución de conflictos ha sido completada
 */
ipcMain.on('conflict-resolution-completed', (event, data) => {
    windowManager.completeConflictResolution(data);
});

/**
 * Recibe la notificación de que la resolución de conflictos ha sido cancelada
 */
ipcMain.on('conflict-resolution-cancelled', () => {
    windowManager.cancelConflictResolution();
});

/**
 * Maneja solicitudes explícitas de datos de conflicto
 * Útil cuando la ventana de conflictos se carga después de que los datos han sido enviados
 */
ipcMain.on('request-conflict-data', (event) => {
    if (windowManager.conflictWindow && windowManager.lastConflictData) {
        windowManager.conflictWindow.webContents.send('conflict-data', windowManager.lastConflictData);
    }
});

// Iniciar la aplicación cuando Electron esté listo
app.whenReady().then(createWindow);

// Cerrar la aplicación cuando todas las ventanas se cierren (excepto en macOS)
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// En macOS, recrear la ventana cuando se haga clic en el icono del dock
app.on('activate', () => {
    if (windowManager.mainWindow === null) createWindow();
});