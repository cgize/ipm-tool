const { searchAndMerge } = require('./mergeprocessor.js');
const { dialog } = require('@electron/remote');
const path = require('path');
const remote = require('@electron/remote');
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
            storage.get('appSettings', (error, data) => {
                if (error) {
                    console.error('Error loading settings:', error);
                    return;
                }
                
                // Crear settings si no existen
                const settings = data || {};
                
                if (inputElement === modsPathInput) {
                    settings.modsPath = selectedPath;
                } else if (inputElement === steamModsPathInput) {
                    settings.steamModsPath = selectedPath;
                }
                
                storage.set('appSettings', settings, (error) => {
                    if (error) console.error('Error saving settings:', error);
                });
            });
            
            // Solo limpiar ipmtool cuando se selecciona la ruta principal de mods
            if (inputElement === modsPathInput) {
                const ipmToolPath = path.join(selectedPath, 'ipmtool');
                try {
                    await fs.access(ipmToolPath);
                    await fs.rm(ipmToolPath, { recursive: true, force: true });
                } catch (err) {
                    if (err.code !== 'ENOENT') console.error('Error deleting folder:', err);
                }
            }
        }
    }

    selectModsPathBtn.addEventListener('click', () => selectDirectory(modsPathInput));
    selectSteamModsPathBtn.addEventListener('click', () => selectDirectory(steamModsPathInput));
    
    // Configurar listeners para los radio buttons
    document.getElementById('combineOnlyConflicts').addEventListener('change', (e) => {
        storage.get('appSettings', (error, data) => {
            if (error) {
                console.error('Error loading settings:', error);
                return;
            }
            
            const settings = data || {};
            settings.combineOnlyConflicts = e.target.checked;
            
            storage.set('appSettings', settings, (error) => {
                if (error) console.error('Error saving settings:', error);
            });
        });
    });
    
    document.getElementById('combineAllMods').addEventListener('change', (e) => {
        storage.get('appSettings', (error, data) => {
            if (error) {
                console.error('Error loading settings:', error);
                return;
            }
            
            const settings = data || {};
            settings.combineOnlyConflicts = !e.target.checked;
            
            storage.set('appSettings', settings, (error) => {
                if (error) console.error('Error saving settings:', error);
            });
        });
    });

    searchAndMergeBtn.addEventListener('click', async () => {
        const modsPath = modsPathInput.value;
        const steamModsPath = steamModsPathInput.value;
        
        if (!modsPath) {
            alert('Please select the Game Mods path');
            return;
        }
    
        // Limpiar carpeta ipmtool antes de comenzar
        const ipmToolPath = path.join(modsPath, 'ipmtool');
        try {
            await fs.rm(ipmToolPath, { recursive: true, force: true });
        } catch (err) {
            if (err.code !== 'ENOENT') console.error('Error deleting folder:', err);
        }
    
        processingDiv.style.display = 'block';
        resultDiv.style.display = 'none';
        processingList.innerHTML = '';
        logContentElement.textContent = '';

        const combineOnlyConflicts = document.getElementById('combineOnlyConflicts').checked;
        
        // Guardar la configuración actualizada
        storage.get('appSettings', (error, data) => {
            if (error) {
                console.error('Error loading settings:', error);
                return;
            }
            
            const settings = data || {};
            settings.combineOnlyConflicts = combineOnlyConflicts;
            
            storage.set('appSettings', settings, (error) => {
                if (error) console.error('Error saving settings:', error);
            });
        });

        const options = {
            onProcessingFile: (fileName) => {
                const li = document.createElement('li');
                li.textContent = fileName;
                processingList.appendChild(li);
            },
            combineOnlyConflicts: combineOnlyConflicts,
            steamModsPath: steamModsPath // Pass steam mods path to the processor
        };

        try {
            const result = await searchAndMerge(modsPath, options);
            const logPath = path.join(modsPath, 'ipmtool', 'ipmtool.log');
            await fs.writeFile(logPath, result.logContent);

            // Actualizar UI
            resultDiv.style.display = 'block';
            resultMessage.textContent = result.message;
            logContentElement.textContent = result.logContent;

            // Mostrar mods combinados
            const modsList = document.getElementById('modsList');
            const combinedModsDiv = document.getElementById('combinedMods');
            modsList.innerHTML = '';
            
            if (result.combinedMods.length > 0) {
                combinedModsDiv.style.display = 'block';
                result.combinedMods.forEach(modId => {
                    const li = document.createElement('li');
                    li.textContent = modId;
                    modsList.appendChild(li);
                });
            } else {
                combinedModsDiv.style.display = 'none';
            }

        } catch (error) {
            resultDiv.style.display = 'block';
            resultMessage.textContent = error.message;
            logContentElement.textContent = error.logContent || 'No log available';
        } finally {
            processingDiv.style.display = 'none';
        }
    });
});