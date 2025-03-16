// window-manager.js
// Módulo para gestionar las ventanas de la aplicación

const { BrowserWindow } = require('electron');
const path = require('path');
const remoteMain = require('@electron/remote/main');

/**
 * Clase que gestiona las ventanas de la aplicación
 */
class WindowManager {
    constructor() {
        this.mainWindow = null;
        this.conflictWindow = null;
        this.pendingResolveCallback = null;
        this.lastConflictData = null;
    }

    /**
     * Crea la ventana principal de la aplicación
     * @returns {BrowserWindow} - Referencia a la ventana principal
     */
    createMainWindow() {
        this.mainWindow = new BrowserWindow({
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
        remoteMain.enable(this.mainWindow.webContents);
        
        // Cargar el HTML desde la ruta correcta
        this.mainWindow.loadFile(path.join(__dirname, 'index.html'));
        
        return this.mainWindow;
    }

    /**
     * Crea la ventana de resolución de conflictos
     * @param {Array} conflicts - Lista de conflictos a resolver
     * @param {Array} modDetails - Detalles de los mods en conflicto
     * @returns {Promise} - Promesa que se resolverá con la decisión del usuario
     */
    createConflictWindow(conflicts, modDetails) {
        // Almacenar los datos de conflicto para posibles solicitudes futuras
        this.lastConflictData = {
            conflicts: conflicts,
            modDetails: modDetails
        };
        
        this.conflictWindow = new BrowserWindow({
            parent: this.mainWindow,
            modal: true,
            width: 700,
            height: 800,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                enableRemoteModule: true
            },
            autoHideMenuBar: true,
            frame: false,  // Sin barra de título
            resizable: true,
            titleBarStyle: 'hidden',  // Ocultar barra de título pero mantener los controles de ventana
            titleBarOverlay: false
        });
        
        remoteMain.enable(this.conflictWindow.webContents);
        this.conflictWindow.loadFile(path.join(__dirname, 'conflict-dialog.html'));
        
        // Asegurarse de que la ventana esté completamente cargada antes de enviar los datos
        this.conflictWindow.once('ready-to-show', () => {
            // Pequeño retraso para asegurar que los manejadores de eventos estén registrados
            setTimeout(() => {
                if (this.conflictWindow && !this.conflictWindow.isDestroyed()) {
                    this.conflictWindow.webContents.send('conflict-data', this.lastConflictData);
                }
            }, 200); // Aumentado a 200ms para dar más tiempo a que se registren los handlers
        });
        
        return new Promise((resolve) => {
            this.pendingResolveCallback = resolve;
            
            // Si la ventana se cierra sin resolver
            this.conflictWindow.on('closed', () => {
                if (this.pendingResolveCallback) {
                    this.pendingResolveCallback({ cancelled: true });
                    this.pendingResolveCallback = null;
                }
            });
        });
    }

    /**
     * Completa la resolución de conflictos con los datos proporcionados
     * @param {Object} data - Datos de la resolución
     */
    completeConflictResolution(data) {
        if (this.pendingResolveCallback) {
            this.pendingResolveCallback(data);
            this.pendingResolveCallback = null;
            
            if (this.conflictWindow && !this.conflictWindow.isDestroyed()) {
                this.conflictWindow.close();
            }
        }
    }

    /**
     * Cancela la resolución de conflictos
     */
    cancelConflictResolution() {
        if (this.pendingResolveCallback) {
            this.pendingResolveCallback({ cancelled: true });
            this.pendingResolveCallback = null;
            
            if (this.conflictWindow && !this.conflictWindow.isDestroyed()) {
                this.conflictWindow.close();
            }
        }
    }

    /**
     * Verifica si la ventana de conflictos está abierta
     * @returns {boolean} - True si la ventana está abierta y accesible
     */
    isConflictWindowOpen() {
        return this.conflictWindow !== null && !this.conflictWindow.isDestroyed();
    }

    /**
     * Cierra todas las ventanas abiertas
     */
    closeAllWindows() {
        if (this.conflictWindow && !this.conflictWindow.isDestroyed()) {
            this.conflictWindow.close();
            this.conflictWindow = null;
        }
        
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.close();
            this.mainWindow = null;
        }
    }
}

module.exports = WindowManager;