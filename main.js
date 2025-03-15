// PROYECTO/main.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
// Importar y configurar @electron/remote
const remoteMain = require('@electron/remote/main');
remoteMain.initialize();

function createWindow() {
    const win = new BrowserWindow({
        width: 700,
        height: 1000,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true
        },
        autoHideMenuBar: true, // Añade esta línea para ocultar la barra de menú
        frame: false, // Oculta la barra de título
        resizable: false // Fija el tamaño de la ventana
        
    });
    
    // Habilitar remote para esta ventana específica
    remoteMain.enable(win.webContents);
    
    // Cargar el HTML desde la ruta correcta
    win.loadFile(path.join(__dirname, 'src', 'index.html'));
    
    // Opcional: abrir DevTools para depuración
    // win.webContents.openDevTools();
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});