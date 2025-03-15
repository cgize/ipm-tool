// main.js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
// Importar y configurar @electron/remote
const remoteMain = require('@electron/remote/main');
remoteMain.initialize();

let mainWindow;
let conflictWindow;
let pendingResolveCallback = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 700,
        height: 1000,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true
        },
        autoHideMenuBar: true,
        frame: false,
        resizable: false
    });
    
    // Habilitar remote para esta ventana específica
    remoteMain.enable(mainWindow.webContents);
    
    // Cargar el HTML desde la ruta correcta
    mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
    
    // Opcional: abrir DevTools para depuración
    // mainWindow.webContents.openDevTools();
}

// Crear ventana de resolución de conflictos
function createConflictWindow(conflicts, modDetails) {
    conflictWindow = new BrowserWindow({
        parent: mainWindow,
        modal: true,
        width: 800,
        height: 650,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true
        },
        autoHideMenuBar: true,
        frame: false,
        resizable: true
    });
    
    remoteMain.enable(conflictWindow.webContents);
    conflictWindow.loadFile(path.join(__dirname, 'src', 'conflict-dialog.html'));
    
    conflictWindow.once('ready-to-show', () => {
        conflictWindow.webContents.send('conflict-data', {
            conflicts: conflicts,
            modDetails: modDetails
        });
    });
    
    return new Promise((resolve) => {
        pendingResolveCallback = resolve;
        
        // Si la ventana se cierra sin resolver
        conflictWindow.on('closed', () => {
            if (pendingResolveCallback) {
                pendingResolveCallback({ cancelled: true });
                pendingResolveCallback = null;
            }
        });
    });
}

// Gestionar eventos IPC
ipcMain.handle('show-conflict-resolution', async (event, data) => {
    return await createConflictWindow(data.conflicts, data.modDetails);
});

ipcMain.on('conflict-resolution-completed', (event, data) => {
    if (pendingResolveCallback) {
        pendingResolveCallback(data);
        pendingResolveCallback = null;
        conflictWindow.close();
    }
});

ipcMain.on('conflict-resolution-cancelled', () => {
    if (pendingResolveCallback) {
        pendingResolveCallback({ cancelled: true });
        pendingResolveCallback = null;
        conflictWindow.close();
    }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});