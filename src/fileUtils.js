// fileUtils.js
const fs = require('fs').promises;
const path = require('path');
const yauzl = require('yauzl');
const { XMLParser } = require('fast-xml-parser');

/**
 * Busca de forma recursiva todos los archivos .pak en el directorio especificado
 * @param {string} modsPath - Ruta del directorio de mods
 * @returns {Promise<string[]>} - Lista de rutas completas a los archivos .pak encontrados
 */
async function findPakFiles(modsPath) {
    async function searchDir(dir) {
        let pakFiles = [];
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                pakFiles = pakFiles.concat(await searchDir(fullPath));
            } else if (entry.isFile() && entry.name.endsWith('.pak')) {
                pakFiles.push(fullPath);
            }
        }
        return pakFiles;
    }

    return await searchDir(modsPath);
}

/**
 * Obtiene el orden de los mods desde el archivo mod_order.txt
 * @param {string} modsPath - Ruta del directorio de mods
 * @returns {Promise<string[]>} - Lista de IDs de mods en el orden especificado
 */
async function getModOrder(modsPath) {
    const modOrderPath = path.join(modsPath, 'mod_order.txt');
    try {
        const content = await fs.readFile(modOrderPath, 'utf8');
        return content
            .split('\n')
            .filter(line => line.trim() !== '')
            .map(line => line.trim());
    } catch (error) {
        return [];
    }
}

/**
 * Extrae el ID del mod a partir de la ruta de un archivo .pak
 * Intenta leer el archivo mod.manifest, si no existe usa el nombre de la carpeta
 * @param {string} pakFilePath - Ruta al archivo .pak
 * @returns {Promise<string>} - ID del mod normalizado (en minúsculas y con guiones bajos)
 */
async function extractModIdFromPak(pakFilePath) {
    const modFolder = path.dirname(path.dirname(pakFilePath));
    const manifestPath = path.join(modFolder, 'mod.manifest');
    try {
        await fs.access(manifestPath);
        const manifestContent = await fs.readFile(manifestPath, 'utf8');
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: "@_"
        });
        const parsedManifest = parser.parse(manifestContent);

        if (parsedManifest?.kcd_mod?.info?.["@_modid"]) {
            return parsedManifest.kcd_mod.info["@_modid"];
        }
        if (parsedManifest?.kcd_mod?.info?.["@_name"]) {
            return parsedManifest.kcd_mod.info["@_name"].toLowerCase().replace(/\s+/g, '_');
        }
    } catch (error) {}
    
    const folderName = path.basename(modFolder);
    return folderName.toLowerCase().replace(/\s+/g, '_');
}

/**
 * Extrae todos los archivos XML relevantes (InventoryPreset) de los archivos .pak
 * @param {string[]} pakFiles - Lista de rutas a los archivos .pak
 * @param {string[]} modOrder - Lista de IDs de mods en orden de prioridad
 * @param {Function} onProcessingFile - Callback para notificar cada archivo procesado
 * @returns {Promise<Object>} - Objeto con arrays de XMLs procesados y IDs de mods
 */
async function extractRelevantXmls(pakFiles, modOrder, onProcessingFile) {
    const allXmls = [];

    for (const pakFile of pakFiles) {
        let modId;
        try {
            // Obtener el ID del mod para este archivo .pak
            modId = await extractModIdFromPak(pakFile);
        } catch (error) {
            console.error(`Error getting modId from ${pakFile}: ${error.message}`);
            modId = null;
        }

        try {
            // Abrir y procesar el contenido del archivo .pak
            await new Promise((resolve, reject) => {
                yauzl.open(pakFile, { lazyEntries: true }, (err, zip) => {
                    if (err) return reject(err);

                    zip.on('entry', (entry) => {
                        // Filtrar solo los archivos XML de InventoryPreset
                        if (entry.fileName.startsWith('Libs/Tables/item/') &&
                            entry.fileName.includes('InventoryPreset__') &&
                            entry.fileName.endsWith('.xml')) {

                            zip.openReadStream(entry, async (err, readStream) => {
                                if (err) return;
                                if (onProcessingFile) onProcessingFile(entry.fileName);

                                let xmlContent = '';
                                readStream.on('data', (chunk) => xmlContent += chunk);
                                readStream.on('end', () => {
                                    // Calcular la prioridad del mod según su posición en mod_order.txt
                                    // Mayor número = Mayor prioridad
                                    const modIndex = modOrder.indexOf(modId);
                                    const priority = modIndex === -1 ? -1 : modOrder.length - modIndex;
                                    
                                    allXmls.push({
                                        content: xmlContent,
                                        modId: modId,
                                        priority: priority,
                                        fileName: entry.fileName
                                    });
                                    
                                    zip.readEntry();
                                });
                            });
                        } else {
                            zip.readEntry();
                        }
                    });

                    zip.on('end', () => resolve());
                    zip.readEntry();
                });
            });
        } catch (error) {
            console.error(`Error processing ${pakFile}:`, error.message);
        }
    }

    // Ordenar los XMLs por prioridad descendente (mayor prioridad primero)
    allXmls.sort((a, b) => b.priority - a.priority);
    
    return {
        xmls: allXmls,
        modIds: [...new Set(allXmls.map(xml => xml.modId).filter(id => id !== null))]
    };
}

module.exports = {
    findPakFiles,
    getModOrder,
    extractModIdFromPak,
    extractRelevantXmls
};