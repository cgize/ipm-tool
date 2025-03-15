// fileUtils.js
const fs = require('fs').promises;
const path = require('path');
const yauzl = require('yauzl');
const { XMLParser } = require('fast-xml-parser');

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
                // Omitir la carpeta z para evitar procesar archivos previamente generados
                if (entry.isDirectory() && entry.name !== 'zipmtool') {
                    pakFiles = pakFiles.concat(await searchDir(fullPath));
                } else if (entry.isFile() && entry.name.endsWith('.pak')) {
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
    const modOrderPath = path.join(modsPath, 'mod_order.txt');
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
 * Intenta leer el archivo mod.manifest, si no existe usa el nombre de la carpeta
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
            attributeNamePrefix: "@_"
        });
        const parsedManifest = parser.parse(manifestContent);

        if (parsedManifest?.kcd_mod?.info?.["@_modid"]) {
            return parsedManifest.kcd_mod.info["@_modid"];
        }
        if (parsedManifest?.kcd_mod?.info?.["@_name"]) {
            return parsedManifest.kcd_mod.info["@_name"].toLowerCase().replace(/\s+/g, '_');
        }
    } catch (error) {
        // Si hay un error al leer el manifiesto y es un mod de Steam Workshop,
        // intentamos buscar otros indicadores del ID del mod
        if (isSteamWorkshopMod) {
            try {
                // Buscar cualquier archivo XML dentro del directorio que pueda contener información del mod
                const files = await fs.readdir(modFolder, { withFileTypes: true });
                for (const file of files) {
                    if (file.isFile() && file.name.endsWith('.xml')) {
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
    
    // Si es un mod de Steam Workshop, añadir un prefijo para mejor identificación
    if (isSteamWorkshopMod) {
        return `steam_${folderName}`.toLowerCase().replace(/\s+/g, '_');
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
                                if (onProcessingFile) onProcessingFile(`${modId} - ${entry.fileName}`);

                                let xmlContent = '';
                                readStream.on('data', (chunk) => xmlContent += chunk);
                                readStream.on('end', () => {
                                    // Calcular la prioridad del mod según su posición en mod_order.txt
                                    // Mayor número = Mayor prioridad
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
                                        console.error(`Error extracting item values from ${entry.fileName}:`, e);
                                    }
                                    
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
 * Extrae valores de los items de un archivo XML para detectar conflictos
 * @param {string} xmlContent - Contenido del archivo XML
 * @param {string} modId - ID del mod
 * @param {Map} modDetails - Mapa con detalles de los mods
 * @param {Map} conflictItemValues - Mapa para detectar conflictos
 */
function extractItemValues(xmlContent, modId, modDetails, conflictItemValues) {
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_"
    });
    
    try {
        const parsed = parser.parse(xmlContent);
        const database = parsed.database;
        const inventoryPresets = database?.InventoryPresets;
        const presets = inventoryPresets?.InventoryPreset;
        
        if (!presets) return;
        
        const presetArray = Array.isArray(presets) ? presets : [presets];
        
        for (const preset of presetArray) {
            const presetName = preset["@_Name"];
            if (!presetName) continue;
            
            const presetItems = preset.PresetItem;
            if (!presetItems) continue;
            
            const itemArray = Array.isArray(presetItems) ? presetItems : [presetItems];
            
            for (const item of itemArray) {
                const itemName = item["@_Name"];
                if (!itemName) continue;
                
                // Extraer valores importantes como cantidad o valor
                // Revisa ambos atributos: Count y Amount
                const count = item["@_Count"];
                const amount = item["@_Amount"]; // Añadido para detectar el atributo Amount
                const value = item["@_Value"];
                
                // Almacenar los valores en los detalles del mod
                if (modDetails.has(modId)) {
                    modDetails.get(modId).presetItems.set(itemName, { 
                        count, 
                        amount, // Añadido
                        value 
                    });
                }
                
                // Registrar el item para detectar conflictos
                // Verifica si hay algún valor definido entre count, amount o value
                if (count !== undefined || amount !== undefined || value !== undefined) {
                    if (!conflictItemValues.has(itemName)) {
                        conflictItemValues.set(itemName, []);
                    }
                    
                    conflictItemValues.get(itemName).push({
                        modId,
                        count,
                        amount, // Añadido
                        value
                    });
                }
            }
        }
    } catch (error) {
        console.error("Error parsing XML content:", error);
    }
}

/**
 * Detecta conflictos entre mods basados en los valores de los items
 * @param {Map} conflictItemValues - Mapa con los valores de los items por mod
 * @returns {Array} - Lista de grupos de mods en conflicto
 */
function detectModConflicts(conflictItemValues) {
    const conflicts = [];
    const modsInConflict = new Set();
    
    // Analizar cada item para detectar conflictos
    for (const [itemName, modValues] of conflictItemValues.entries()) {
        if (modValues.length > 1) {
            // Verificar si hay valores diferentes
            const uniqueValues = new Set();
            let hasConflict = false;
            
            // Primero, consolidar modValues por modId para evitar duplicados del mismo mod
            const consolidatedModValues = new Map();
            for (const modValue of modValues) {
                const modId = modValue.modId;
                consolidatedModValues.set(modId, modValue);
            }
            
            // Ahora usar los valores consolidados para detectar conflictos
            for (const modValue of consolidatedModValues.values()) {
                const valueKey = `${modValue.count || ''}_${modValue.amount || ''}_${modValue.value || ''}`;
                uniqueValues.add(valueKey);
                
                if (uniqueValues.size > 1) {
                    hasConflict = true;
                    break;
                }
            }
            
            if (hasConflict) {
                const conflictGroup = {
                    itemName,
                    mods: Array.from(consolidatedModValues.values()).map(mv => ({
                        modId: mv.modId,
                        count: mv.count,
                        amount: mv.amount,
                        value: mv.value
                    }))
                };
                
                conflicts.push(conflictGroup);
                
                // Registrar los mods que tienen conflictos
                for (const modValue of consolidatedModValues.values()) {
                    modsInConflict.add(modValue.modId);
                }
            }
        }
    }
    
    return conflicts;
}

module.exports = {
    findPakFiles,
    getModOrder,
    extractModIdFromPak,
    extractRelevantXmls
};