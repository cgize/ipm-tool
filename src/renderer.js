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
                // Comprobar si la carpeta existe
                await fs.access(ipmToolPath);
                // Eliminar la carpeta de manera recursiva
                await fs.rm(ipmToolPath, { recursive: true, force: true });
                console.log(`Carpeta eliminada: ${ipmToolPath}`);
            } catch (err) {
                if (err.code !== 'ENOENT') {
                    console.error(`Error al eliminar ${ipmToolPath}:`, err);
                }
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

        processingDiv.style.display = 'block';
        resultDiv.style.display = 'none';
        processingList.innerHTML = '';

        try {
            const result = await searchAndMerge(modsPath, {
                onProcessingFile: (fileName) => {
                    const li = document.createElement('li');
                    li.textContent = fileName;
                    processingList.appendChild(li);
                }
            });

            resultDiv.style.display = 'block';
            resultMessage.textContent = result.message;

            const modsList = document.getElementById('modsList');
            const combinedModsDiv = document.getElementById('combinedMods');
            modsList.innerHTML = '';
            combinedModsDiv.style.display = 'block';

            result.combinedMods.forEach(modId => {
                const li = document.createElement('li');
                li.textContent = modId;
                modsList.appendChild(li);
            });

        } catch (error) {
            resultDiv.style.display = 'block';
            resultMessage.textContent = `Error: ${error.message}`;
        } finally {
            processingDiv.style.display = 'none';
        }
    });
});
