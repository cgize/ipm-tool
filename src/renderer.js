const { searchAndMerge } = require('./mergeprocessor.js');
const { dialog } = require('@electron/remote');
const path = require('path');
const remote = require('@electron/remote');
const fs = require('fs').promises;

document.addEventListener('DOMContentLoaded', () => {
    const modsPathInput = document.getElementById('modsPath');
    const selectModsPathBtn = document.getElementById('selectModsPath');
    const searchAndMergeBtn = document.getElementById('searchAndMerge');
    const processingDiv = document.getElementById('processing');
    const processingList = document.getElementById('processingList');
    const resultDiv = document.getElementById('result');
    const resultMessage = document.getElementById('resultMessage');
    const logContentElement = document.getElementById('logContent');

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
            const modsPath = result.filePaths[0];
            inputElement.value = modsPath;

            const ipmToolPath = path.join(modsPath, 'ipmtool');
            try {
                await fs.access(ipmToolPath);
                await fs.rm(ipmToolPath, { recursive: true, force: true });
            } catch (err) {
                if (err.code !== 'ENOENT') console.error('Error deleting folder:', err);
            }
        }
    }

    selectModsPathBtn.addEventListener('click', () => selectDirectory(modsPathInput));

    searchAndMergeBtn.addEventListener('click', async () => {
        const modsPath = modsPathInput.value;
        if (!modsPath) {
            alert('Please select the Mods path');
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

        const options = {
            onProcessingFile: (fileName) => {
                const li = document.createElement('li');
                li.textContent = fileName;
                processingList.appendChild(li);
            },
            combineOnlyConflicts: document.getElementById('combineOnlyConflicts').checked
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