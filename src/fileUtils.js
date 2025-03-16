// fileUtils.js
// Módulo para buscar archivos .pak y extraer información de mods

const fs = require('fs').promises;
const path = require('path');
const yauzl = require('yauzl');
const { XMLParser } = require('fast-xml-parser');
const { extractItemValues, detectModConflicts } = require('./conflict-manager');
const config = require('./config');

/**
 * Busca de forma recursiva todos los archivos .pak en el directorio especificado
 * y opcionalmente también en el directorio de Steam Workshop
 * @param {string} modsPath - Ruta del directorio de mods
 * @param {string|null} steamModsPath - Ruta del directorio de mods de Steam Workshop (opcional)
 * @returns {Promise<string[]>} - Lista de rutas completas a los archivos .pak encontrados
 */
async function findPakFiles(modsPath, steamModsPath = null) {
    async function searchDir(dir) {
        let pakFiles = [];
        try {
            const entries = await fs.readdir(dir, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                // Omitir la carpeta de salida para evitar procesar archivos previamente generados
                if (entry.isDirectory() && entry.name !== config.PATHS.OUTPUT_FOLDER) {
                    pakFiles = pakFiles.concat(await searchDir(fullPath));
                } else if (entry.isFile() && entry.name.endsWith(config.FILES.PAK_EXTENSION)) {
                    pakFiles.push(fullPath);
                }
            }
        } catch (error) {
            console.error(`Error reading directory ${dir}: ${error.message}`);
        }
        return pakFiles;
    }

    // Buscar en el directorio principal de mods
    let allPakFiles = await searchDir(modsPath);
    
    // Si se proporciona un directorio de Steam Workshop, buscar también allí
    if (steamModsPath) {
        try {
            // Verificar que el directorio existe antes de buscar en él
            await fs.access(steamModsPath);
            const steamPakFiles = await searchDir(steamModsPath);
            allPakFiles = allPakFiles.concat(steamPakFiles);
        } catch (error) {
            console.error(`Error accessing Steam Workshop directory: ${error.message}`);
        }
    }
    
    return allPakFiles;
}

/**
 * Obtiene el orden de los mods desde el archivo mod_order.txt
 * @param {string} modsPath - Ruta del directorio de mods
 * @returns {Promise<{modOrder: string[], exists: boolean}>} - Lista de IDs de mods en el orden especificado y si existe el archivo
 */
async function getModOrder(modsPath) {
    const modOrderPath = path.join(modsPath, config.PATHS.MOD_ORDER_FILE);
    try {
        const content = await fs.readFile(modOrderPath, 'utf8');
        return {
            modOrder: content
                .split('\n')
                .filter(line => line.trim() !== '')
                .map(line => line.trim()),
            exists: true
        };
    } catch (error) {
        return {
            modOrder: [],
            exists: false
        };
    }
}

/**
 * Extrae el ID del mod a partir de la ruta de un archivo .pak
 * Para mods de Steam Workshop, usa el nombre del archivo .pak en lugar del nombre de la carpeta
 * @param {string} pakFilePath - Ruta al archivo .pak
 * @returns {Promise<string>} - ID del mod normalizado (en minúsculas y con guiones bajos)
 */
async function extractModIdFromPak(pakFilePath) {
    const modFolder = path.dirname(path.dirname(pakFilePath));
    const manifestPath = path.join(modFolder, 'mod.manifest');
    
    // Verificar si es una carpeta de Steam Workshop (típicamente un número)
    const folderName = path.basename(modFolder);
    const isSteamWorkshopMod = /^\d+$/.test(folderName);
    
    try {
        await fs.access(manifestPath);
        const manifestContent = await fs.readFile(manifestPath, 'utf8');
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: config.XML.ATTRIBUTE_PREFIX
        });
        const parsedManifest = parser.parse(manifestContent);

        if (parsedManifest?.kcd_mod?.info?.[`${config.XML.ATTRIBUTE_PREFIX}modid`]) {
            return parsedManifest.kcd_mod.info[`${config.XML.ATTRIBUTE_PREFIX}modid`];
        }
        if (parsedManifest?.kcd_mod?.info?.[`${config.XML.ATTRIBUTE_PREFIX}name`]) {
            return parsedManifest.kcd_mod.info[`${config.XML.ATTRIBUTE_PREFIX}name`].toLowerCase().replace(/\s+/g, '_');
        }
    } catch (error) {
        // Si hay un error al leer el manifiesto y es un mod de Steam Workshop,
        // intentamos buscar otros indicadores del ID del mod
        if (isSteamWorkshopMod) {
            try {
                // Buscar cualquier archivo XML dentro del directorio que pueda contener información del mod
                const files = await fs.readdir(modFolder, { withFileTypes: true });
                for (const file of files) {
                    if (file.isFile() && file.name.endsWith(config.FILES.XML_EXTENSION)) {
                        const content = await fs.readFile(path.join(modFolder, file.name), 'utf8');
                        // Buscar patrones comunes de ID de mod en el contenido
                        const modIdMatch = content.match(/modid="([^"]+)"/i) || content.match(/name="([^"]+)"/i);
                        if (modIdMatch && modIdMatch[1]) {
                            return modIdMatch[1].toLowerCase().replace(/\s+/g, '_');
                        }
                    }
                }
            } catch (subError) {
                // Si falla la búsqueda secundaria, continuamos con el método estándar
            }
        }
    }
    
    // Si es un mod de Steam Workshop, usar el nombre del archivo .pak en lugar del nombre de la carpeta
    if (isSteamWorkshopMod) {
        // Extraer el nombre del archivo .pak sin la extensión
        const pakFileName = path.basename(pakFilePath, config.FILES.PAK_EXTENSION);
        return `${config.MODS.STEAM_MOD_PREFIX}${pakFileName}`.toLowerCase().replace(/\s+/g, '_');
    }
    
    return folderName.toLowerCase().replace(/\s+/g, '_');
}

/**
 * Extrae todos los archivos XML relevantes (InventoryPreset) de los archivos .pak
 * @param {string[]} pakFiles - Lista de rutas a los archivos .pak
 * @param {Object} modOrderData - Objeto con la lista de IDs de mods en orden de prioridad y si existe el archivo
 * @param {Function} onProcessingFile - Callback para notificar cada archivo procesado
 * @returns {Promise<Object>} - Objeto con arrays de XMLs procesados, IDs de mods y conflictos
 */
async function extractRelevantXmls(pakFiles, modOrderData, onProcessingFile) {
    const allXmls = [];
    const processedModIds = new Set();
    const modDetails = new Map(); // Para almacenar detalles de los mods
    const conflictItemValues = new Map(); // Mapa para detectar conflictos en valores de items
    
    const { modOrder, exists: modOrderExists } = modOrderData;

    for (const pakFile of pakFiles) {
        let modId;
        try {
            // Obtener el ID del mod para este archivo .pak
            modId = await extractModIdFromPak(pakFile);
        } catch (error) {
            console.error(`Error getting modId from ${pakFile}: ${error.message}`);
            modId = null;
        }

        if (modId) {
            processedModIds.add(modId);
            
            if (!modDetails.has(modId)) {
                modDetails.set(modId, {
                    id: modId,
                    path: pakFile,
                    presetItems: new Map(), // Para almacenar los items que modifica
                    priority: -1
                });
            }
        }

        try {
            // Implementar timeout para evitar bloqueos
            await Promise.race([
                processPakFile(pakFile, modId, modOrder, modDetails, allXmls, conflictItemValues, onProcessingFile),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error(`Timeout processing ${pakFile}`)), 60000) // 60 segundos de timeout
                )
            ]);
        } catch (error) {
            console.error(`Error processing ${pakFile}: ${error.message}`);
            // Notificar el error y continuar con el siguiente archivo
            if (onProcessingFile) onProcessingFile(`Error en ${modId || 'mod desconocido'} - ${pakFile}: ${error.message}`);
        }
    }

    // Detectar conflictos entre mods
    const conflicts = detectModConflicts(conflictItemValues);

    // Ordenar los XMLs por prioridad descendente (mayor prioridad primero)
    if (modOrderExists) {
        allXmls.sort((a, b) => b.priority - a.priority);
    }
    
    return {
        xmls: allXmls,
        modIds: Array.from(processedModIds),
        modDetails: modDetails,
        conflicts: conflicts,
        needsManualOrder: !modOrderExists && conflicts.length > 0
    };
}

/**
 * Procesa un archivo .pak individuamente con manejo mejorado de errores
 * @param {string} pakFile - Ruta al archivo .pak
 * @param {string} modId - ID del mod
 * @param {Array} modOrder - Orden de prioridad de los mods
 * @param {Map} modDetails - Detalles de los mods
 * @param {Array} allXmls - Lista de XMLs procesados
 * @param {Map} conflictItemValues - Valores de items para detectar conflictos
 * @param {Function} onProcessingFile - Callback para notificar cada archivo procesado
 * @returns {Promise} - Promesa que se resuelve cuando se completa el procesamiento
 */
async function processPakFile(pakFile, modId, modOrder, modDetails, allXmls, conflictItemValues, onProcessingFile) {
    return new Promise((resolve, reject) => {
        yauzl.open(pakFile, { lazyEntries: true }, (err, zip) => {
            if (err) return reject(err);
            
            let entryCount = 0;
            const maxEntries = 15000; // Límite de seguridad para evitar bucles infinitos
            
            zip.on('entry', (entry) => {
                entryCount++;
                if (entryCount > maxEntries) {
                    zip.close();
                    return reject(new Error(`Demasiadas entradas en ${pakFile}, posible archivo corrupto`));
                }
                
                try {
                    // Verificar de manera segura si es un archivo XML relevante
                    if (entry.fileName && 
                        entry.fileName.startsWith(config.FILES.XML_SEARCH_PATH) &&
                        entry.fileName.includes(config.FILES.XML_FILE_PATTERN) &&
                        entry.fileName.endsWith(config.FILES.XML_EXTENSION)) {

                        zip.openReadStream(entry, (err, readStream) => {
                            if (err) {
                                console.error(`No se puede abrir la entrada ${entry.fileName}: ${err.message}`);
                                zip.readEntry();
                                return;
                            }
                            
                            if (onProcessingFile) onProcessingFile(`${modId || 'mod desconocido'} - ${entry.fileName}`);
                            
                            let xmlContent = '';
                            
                            readStream.on('data', (chunk) => {
                                try {
                                    xmlContent += chunk.toString('utf8');
                                } catch (e) {
                                    console.error(`Error leyendo datos de ${entry.fileName}: ${e.message}`);
                                }
                            });
                            
                            readStream.on('end', () => {
                                try {
                                    if (xmlContent) {
                                        // Calcular la prioridad del mod según su posición en mod_order.txt
                                        const modIndex = modOrder.indexOf(modId);
                                        const priority = modIndex === -1 ? -1 : modOrder.length - modIndex;
                                        
                                        // Actualizar la prioridad en los detalles del mod
                                        if (modDetails.has(modId)) {
                                            modDetails.get(modId).priority = priority;
                                        }
                                        
                                        allXmls.push({
                                            content: xmlContent,
                                            modId: modId,
                                            priority: priority,
                                            fileName: entry.fileName
                                        });
                                        
                                        // Extraer información de los items para detectar conflictos
                                        try {
                                            extractItemValues(xmlContent, modId, modDetails, conflictItemValues);
                                        } catch (e) {
                                            console.error(`Error extracting item values from ${entry.fileName}: ${e.message}`);
                                        }
                                    }
                                } catch (processError) {
                                    console.error(`Error procesando contenido de ${entry.fileName}: ${processError.message}`);
                                }
                                
                                zip.readEntry();
                            });
                            
                            readStream.on('error', (streamErr) => {
                                console.error(`Error en stream para ${entry.fileName}: ${streamErr.message}`);
                                zip.readEntry();
                            });
                        });
                    } else {
                        // No es un archivo relevante, pasar al siguiente
                        zip.readEntry();
                    }
                } catch (entryError) {
                    console.error(`Error procesando entrada en ${pakFile}: ${entryError.message}`);
                    zip.readEntry(); // Continuar con la siguiente entrada
                }
            });

            zip.on('end', () => {
                resolve();
            });
            
            zip.on('error', (zipErr) => {
                reject(zipErr);
            });
            
            zip.readEntry(); // Iniciar la lectura
        });
    });
}

module.exports = {
    findPakFiles,
    getModOrder,
    extractModIdFromPak,
    extractRelevantXmls
};