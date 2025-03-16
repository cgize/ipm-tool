// renderer.js
// Archivo principal de la aplicación de interfaz de usuario

const { searchAndMerge } = require('./mergeprocessor.js');
const { dialog } = require('@electron/remote');
const path = require('path');
const remote = require('@electron/remote');
const { ipcRenderer } = require('electron'); // Importar directamente de electron, no de remote
const fs = require('fs').promises;
const storage = require('electron-json-storage');
const app = remote.app;

document.addEventListener('DOMContentLoaded', () => {
    const modsPathInput = document.getElementById('modsPath');
    const steamModsPathInput = document.getElementById('steamModsPath');
    const selectModsPathBtn = document.getElementById('selectModsPath');
    const selectSteamModsPathBtn = document.getElementById('selectSteamModsPath');
    const searchAndMergeBtn = document.getElementById('searchAndMerge');
    const processingDiv = document.getElementById('processing');
    const processingList = document.getElementById('processingList');
    const resultDiv = document.getElementById('result');
    const resultMessage = document.getElementById('resultMessage');
    const logContentElement = document.getElementById('logContent');
    
    // Establecer la ruta para el almacenamiento de datos
    const userDataPath = app.getPath('userData');
    storage.setDataPath(userDataPath);
    
    // Cargar las rutas guardadas
    storage.get('appSettings', (error, data) => {
        if (error) {
            console.error('Error loading settings:', error);
            return;
        }
        
        if (data && data.modsPath) {
            modsPathInput.value = data.modsPath;
        }
        
        if (data && data.steamModsPath) {
            steamModsPathInput.value = data.steamModsPath;
        }
        
        // Cargar estado del radio button
        if (data && data.combineOnlyConflicts !== undefined) {
            document.getElementById('combineOnlyConflicts').checked = data.combineOnlyConflicts;
            document.getElementById('combineAllMods').checked = !data.combineOnlyConflicts;
        }
    });

    document.getElementById('minimize-btn').addEventListener('click', () => {
        remote.getCurrentWindow().minimize();
    });

    const maximizeBtn = document.getElementById('maximize-btn');
    if (maximizeBtn) {
        maximizeBtn.addEventListener('click', () => {
            const currentWindow = remote.getCurrentWindow();
            if (currentWindow.isMaximized()) {
                currentWindow.unmaximize();
            } else {
                currentWindow.maximize();
            }
        });
    }

    document.getElementById('close-btn').addEventListener('click', () => {
        remote.getCurrentWindow().close();
    });

    async function selectDirectory(inputElement) {
        const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });

        if (!result.canceled && result.filePaths.length > 0) {
            const selectedPath = result.filePaths[0];
            inputElement.value = selectedPath;
            
            // Guardar la configuración actualizada
            saveSettings({
                modsPath: inputElement === modsPathInput ? selectedPath : undefined,
                steamModsPath: inputElement === steamModsPathInput ? selectedPath : undefined
            });
            
            // Solo limpiar ipmtool cuando se selecciona la ruta principal de mods
            if (inputElement === modsPathInput) {
                await cleanIpmToolDirectory(selectedPath);
            }
        }
    }
    
    // Función auxiliar para limpiar el directorio ipmtool
    async function cleanIpmToolDirectory(modsPath) {
        const ipmToolPath = path.join(modsPath, 'zipmtool');
        try {
            await fs.rm(ipmToolPath, { recursive: true, force: true });
        } catch (err) {
            if (err.code !== 'ENOENT') console.error('Error deleting folder:', err);
        }
    }

    selectModsPathBtn.addEventListener('click', () => selectDirectory(modsPathInput));
    selectSteamModsPathBtn.addEventListener('click', () => selectDirectory(steamModsPathInput));
    
    // Configurar listeners para los radio buttons
    document.getElementById('combineOnlyConflicts').addEventListener('change', (e) => {
        saveSettings({ combineOnlyConflicts: e.target.checked });
    });
    
    document.getElementById('combineAllMods').addEventListener('change', (e) => {
        saveSettings({ combineOnlyConflicts: !e.target.checked });
    });

    searchAndMergeBtn.addEventListener('click', async () => {
        const modsPath = modsPathInput.value;
        const steamModsPath = steamModsPathInput.value;
        
        if (!modsPath) {
            alert('Please select the Game Mods path');
            return;
        }
    
        // Limpiar carpeta ipmtool antes de comenzar
        await cleanIpmToolDirectory(modsPath);
    
        // Mostrar la sección de procesamiento
        processingDiv.style.display = 'block';
        resultDiv.style.display = 'none';
        processingList.innerHTML = '';
        logContentElement.textContent = '';

        const combineOnlyConflicts = document.getElementById('combineOnlyConflicts').checked;
        
        // Guardar la configuración actualizada
        saveSettings({ combineOnlyConflicts });

        const options = {
            onProcessingFile: (fileName) => {
                const li = document.createElement('li');
                li.textContent = fileName;
                processingList.appendChild(li);
                // Auto-scroll para mostrar el último elemento procesado
                processingList.scrollTop = processingList.scrollHeight;
            },
            combineOnlyConflicts,
            steamModsPath: steamModsPath
        };

        try {
            // Primera fase: búsqueda de mods y detección de conflictos
            const result = await searchAndMerge(modsPath, options);
            
            // Comprobar si se necesita ordenación manual de mods
            if (result.needsManualOrder && result.conflicts && result.conflicts.length > 0) {
                processingDiv.style.display = 'none';
                
                // Mostrar ventana de resolución de conflictos
                const resolutionResult = await ipcRenderer.invoke('show-conflict-resolution', {
                    conflicts: result.conflicts,
                    modDetails: result.modDetails
                });
                
                if (resolutionResult.cancelled) {
                    // El usuario canceló la resolución de conflictos
                    resultDiv.style.display = 'block';
                    resultMessage.textContent = 'Proceso cancelado por el usuario';
                    logContentElement.textContent = result.logContent;
                    return;
                }
                
                // Reanudar proceso con el método de resolución seleccionado
                processingDiv.style.display = 'block';
                
                // Opciones actualizadas según el método de resolución
                const finalOptions = {
                    ...options,
                    resolutionMethod: resolutionResult.method || 'manual'
                };
                
                // Si el método es manual, incluir el orden manual
                if (resolutionResult.method === 'manual' && resolutionResult.manualModOrder) {
                    finalOptions.manualModOrder = resolutionResult.manualModOrder;
                }
                
                const finalResult = await searchAndMerge(modsPath, finalOptions);
                
                // Mostrar resultado final
                updateUIWithResult(finalResult);
                
                // Guardar log
                await saveLogFile(modsPath, finalResult.logContent);
            } else {
                // Proceso normal sin conflictos que requieran intervención manual
                updateUIWithResult(result);
                
                // Guardar log
                await saveLogFile(modsPath, result.logContent);
            }
        } catch (error) {
            resultDiv.style.display = 'block';
            resultMessage.textContent = error.message;
            logContentElement.textContent = error.logContent || 'No log available';
            processingDiv.style.display = 'none';
        }
    });
    
    // Función para actualizar la UI con los resultados
    function updateUIWithResult(result) {
        resultDiv.style.display = 'block';
        resultMessage.textContent = result.message;
        logContentElement.textContent = result.logContent;
        processingDiv.style.display = 'none';

        // Mostrar mods combinados
        const modsList = document.getElementById('modsList');
        const combinedModsDiv = document.getElementById('combinedMods');
        modsList.innerHTML = '';
        
        if (result.combinedMods && result.combinedMods.length > 0) {
            combinedModsDiv.style.display = 'block';
            result.combinedMods.forEach(modId => {
                const li = document.createElement('li');
                li.textContent = modId;
                modsList.appendChild(li);
            });
        } else {
            combinedModsDiv.style.display = 'none';
        }
    }
    
    // Función auxiliar para guardar el archivo de log
    async function saveLogFile(modsPath, logContent) {
        if (!logContent) return;
        
        try {
            const logPath = path.join(modsPath, 'zipmtool', 'ipmtool.log');
            await ensureDirectoryExists(path.dirname(logPath));
            await fs.writeFile(logPath, logContent);
        } catch (error) {
            console.error('Error saving log file:', error);
        }
    }

    // Función auxiliar para asegurar que un directorio existe
    async function ensureDirectoryExists(dirPath) {
        try {
            await fs.access(dirPath);
        } catch (error) {
            await fs.mkdir(dirPath, { recursive: true });
        }
    }

    // Función auxiliar para guardar configuración
    function saveSettings(newSettings) {
        storage.get('appSettings', (error, data) => {
            if (error) {
                console.error('Error loading settings:', error);
                return;
            }
            
            // Fusionar la configuración existente con la nueva
            const updatedSettings = { ...data };
            
            if (newSettings.modsPath !== undefined) {
                updatedSettings.modsPath = newSettings.modsPath;
            }
            
            if (newSettings.steamModsPath !== undefined) {
                updatedSettings.steamModsPath = newSettings.steamModsPath;
            }
            
            if (newSettings.combineOnlyConflicts !== undefined) {
                updatedSettings.combineOnlyConflicts = newSettings.combineOnlyConflicts;
            }
            
            storage.set('appSettings', updatedSettings, (error) => {
                if (error) console.error('Error saving settings:', error);
            });
        });
    }
});