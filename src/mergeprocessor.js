const fs = require('fs').promises;
const path = require('path');
const yauzl = require('yauzl');
const xml2js = require('xml2js');
const AdmZip = require('adm-zip');

class Logger {
    constructor() {
        this.logs = [];
        this.pakFiles = [];
        this.xmlFiles = [];
        this.combinedMods = new Map();
    }

    log(type, message) {
        const timestamp = new Date().toISOString();
        this.logs.push(`[${timestamp}] [${type.toUpperCase()}] ${message}`);
    }

    info(message) {
        this.log('info', message);
    }

    error(message) {
        this.log('error', message);
    }

    getLogContent() {
        return [
            "=== IPM Tool Log ===",
            `Generated: ${new Date().toLocaleString()}`,
            "\n== PAK Files Found ==\n" + this.pakFiles.join('\n'),
            "\n== XML Files Processed ==\n" + this.xmlFiles.join('\n'),
            "\n== Mod Processing Details ==\n" + [...this.combinedMods].map(([mod, {priority, xmls}]) => 
                `Mod: ${mod} | Priority: ${priority}\nXMLs: ${xmls.join(', ')}`
            ).join('\n'),
            "\n== Execution Log ==\n" + this.logs.join('\n')
        ].join('\n');
    }
}

// Función  para buscar archivos .pak
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

// Función para obtener el orden de los mods
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

// Función  para extraer modId
async function extractModIdFromPak(pakFilePath) {
    const modFolder = path.dirname(path.dirname(pakFilePath));
    const manifestPath = path.join(modFolder, 'mod.manifest');
    try {
        await fs.access(manifestPath);
        const manifestContent = await fs.readFile(manifestPath, 'utf8');
        const parser = new xml2js.Parser({ explicitArray: false });
        const parsedManifest = await parser.parseStringPromise(manifestContent);

        if (parsedManifest?.kcd_mod?.info?.modid) {
            return parsedManifest.kcd_mod.info.modid;
        }
        if (parsedManifest?.kcd_mod?.info?.name) {
            return parsedManifest.kcd_mod.info.name.toLowerCase().replace(/\s+/g, '_');
        }
    } catch (error) {}
    
    const folderName = path.basename(modFolder);
    return folderName.toLowerCase().replace(/\s+/g, '_');
}

// Función  para extraer XMLs relevantes
async function extractRelevantXmls(pakFiles, modOrder, onProcessingFile) {
    const allXmls = [];

    for (const pakFile of pakFiles) {
        let modId;
        try {
            modId = await extractModIdFromPak(pakFile);
        } catch (error) {
            console.error(`Error getting modId from ${pakFile}: ${error.message}`);
            modId = null;
        }

        try {
            await new Promise((resolve, reject) => {
                yauzl.open(pakFile, { lazyEntries: true }, (err, zip) => {
                    if (err) return reject(err);

                    zip.on('entry', (entry) => {
                        if (entry.fileName.startsWith('Libs/Tables/item/') &&
                            entry.fileName.includes('InventoryPreset__') &&
                            entry.fileName.endsWith('.xml')) {

                            zip.openReadStream(entry, async (err, readStream) => {
                                if (err) return;
                                if (onProcessingFile) onProcessingFile(entry.fileName);

                                let xmlContent = '';
                                readStream.on('data', (chunk) => xmlContent += chunk);
                                readStream.on('end', () => {
                                    allXmls.push({
                                        content: xmlContent,
                                        modId: modId,
                                        priority: modOrder.indexOf(modId),
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

    // Ordenar por prioridad ascendente (menor índice = mayor prioridad)
    allXmls.sort((a, b) => a.priority - b.priority);
    
    return {
        xmls: allXmls,
        modIds: [...new Set(allXmls.map(xml => xml.modId))]
    };
}

// Función para combinar XMLs
async function combineXmls(xmlFiles, combineOnlyConflicts = false) {
    const parser = new xml2js.Parser({
        explicitArray: true,
        preserveChildrenOrder: true,
        ignoreAttrs: false,
        preserveWhitespace: false,
        comment: false
    });

    const builder = new xml2js.Builder({
        renderOpts: { pretty: true, indent: '\t' },
        xmldec: { version: '1.0', encoding: 'us-ascii' }
    });

    // Mapa de presetName a lista de {preset, priority, modId}
    const presetMap = new Map();

    // 1. Recopilar todos los presets con su prioridad
    for (const xmlFile of xmlFiles) {
        try {
            const parsed = await parser.parseStringPromise(xmlFile.content);
            const presets = parsed.database?.InventoryPresets?.[0]?.InventoryPreset;
            if (!presets) continue;
            const presetArray = Array.isArray(presets) ? presets : [presets];
            for (const preset of presetArray) {
                const presetName = preset.$.Name;
                if (!presetName) continue;
                if (!presetMap.has(presetName)) {
                    presetMap.set(presetName, []);
                }
                presetMap.get(presetName).push({
                    preset,
                    priority: xmlFile.priority, // prioridad del mod según mod_order, -1 si no existe
                    modId: xmlFile.modId
                });
            }
        } catch (err) {
            console.error(`Error processing ${xmlFile.fileName}:`, err);
        }
    }

    // Función auxiliar para calcular "puntaje" de atributos numéricos
    function calculateNumericScore(attrs) {
        return Object.values(attrs).reduce((sum, val) => {
            const num = parseFloat(val);
            return sum + (isNaN(num) ? 0 : num);
        }, 0);
    }

    // Función auxiliar para combinar PresetItem de presets conflictivos
    function mergePresetItems(presetObjs) {
        const itemMap = new Map();
        // Iterar por cada preset de la lista
        presetObjs.forEach(presetObj => {
            const presetItems = presetObj.preset.PresetItem || [];
            presetItems.forEach(item => {
                const itemName = item.$.Name;
                // Agregar prioridad del mod al item si no existe
                if (typeof item.modPriority === 'undefined') {
                    item.modPriority = presetObj.priority;
                }
                if (!itemMap.has(itemName)) {
                    itemMap.set(itemName, item);
                } else {
                    const existingItem = itemMap.get(itemName);
                    // Si se tiene mod_order (priority distinto de -1) se usa para comparar
                    if (presetObj.priority !== -1 || existingItem.modPriority !== -1) {
                        // Si la prioridad actual es definida y es menor (mayor prioridad) que la existente, reemplazar
                        if (presetObj.priority !== -1 && (existingItem.modPriority === -1 || presetObj.priority < existingItem.modPriority)) {
                            item.modPriority = presetObj.priority;
                            itemMap.set(itemName, item);
                        }
                    } else {
                        // Si no hay mod_order, comparar cantidad de atributos
                        const currentAttrs = Object.keys(item.$).length;
                        const existingAttrs = Object.keys(existingItem.$).length;
                        if (currentAttrs > existingAttrs) {
                            itemMap.set(itemName, item);
                        } else if (currentAttrs === existingAttrs) {
                            // Si tienen la misma cantidad, comparar valores numéricos
                            const currentScore = calculateNumericScore(item.$);
                            const existingScore = calculateNumericScore(existingItem.$);
                            if (currentScore > existingScore) {
                                itemMap.set(itemName, item);
                            }
                        }
                    }
                }
            });
        });
        
        // Eliminar modPriority de todos los items antes de retornar
        const cleanedItems = Array.from(itemMap.values()).map(item => {
            delete item.modPriority; // Remove the temporary property
            return item;
        });
        
        return cleanedItems;
    }    

    // 2. Seleccionar y combinar los presets y resolver conflictos
    const selectedPresets = [];

    for (const [presetName, presets] of presetMap) {
        let selectedPreset;
        if (presets.length > 1) {
            // Ordenar por prioridad (menor valor = mayor prioridad)
            const sortedPresets = presets.sort((a, b) => a.priority - b.priority);
            const winnerMod = sortedPresets[0].modId;
            console.info(`CONFLICT: ${presetName} - Mods: ${presets.map(p => p.modId).join(', ')}. Winner: ${winnerMod} (Priority: ${sortedPresets[0].priority})`);
            // Combinar todos los PresetItem de los presets conflictivos
            const mergedItems = mergePresetItems(presets);
            // Usar el preset ganador como base
            selectedPreset = JSON.parse(JSON.stringify(sortedPresets[0].preset));
            selectedPreset.PresetItem = mergedItems;
        } else {
            // Solo hay un preset; combinar en caso de duplicados internos
            selectedPreset = JSON.parse(JSON.stringify(presets[0].preset));
            const mergedItems = mergePresetItems(presets);
            selectedPreset.PresetItem = mergedItems;
        }
        selectedPresets.push(selectedPreset);
    }

    // 3. Filtrar presets si combineOnlyConflicts es true
    let finalPresets = selectedPresets;
    if (combineOnlyConflicts) {
        finalPresets = selectedPresets.filter(preset => {
            const presetsForName = presetMap.get(preset.$.Name);
            return presetsForName.length > 1; // Solo incluir presets con conflictos
        });
    }

    // 4. Construir el XML combinado
    const combinedXml = {
        database: {
            '$': {
                'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
                'name': 'barbora',
                'xsi:noNamespaceSchemaLocation': 'InventoryPreset.xsd'
            },
            InventoryPresets: {
                '$': { version: '2' },
                InventoryPreset: finalPresets
            }
        }
    };

    return builder.buildObject(combinedXml);
}

// Función auxiliar para calcular "puntaje" de atributos numéricos
function calculateNumericScore(attrs) {
    return Object.values(attrs).reduce((sum, val) => {
        const num = parseFloat(val);
        return sum + (isNaN(num) ? 0 : num);
    }, 0);
}

// Funciones auxiliares
async function ensureDirectoryExists(dirPath) {
    try {
        await fs.access(dirPath);
    } catch (error) {
        await fs.mkdir(dirPath, { recursive: true });
    }
}

async function createIpmPak(combinedXml, modsPath) {
    const ipmDataPath = path.join(modsPath, 'ipmtool', 'Data');
    await ensureDirectoryExists(ipmDataPath);

    const zip = new AdmZip();
    zip.addFile('Libs/Tables/item/InventoryPreset__ipmtool.xml', Buffer.from(combinedXml));
    
    await fs.writeFile(path.join(ipmDataPath, 'ipmtool.pak'), zip.toBuffer());
}

async function createModManifest(modsPath) {
    const ipmPath = path.join(modsPath, 'ipmtool');
    await ensureDirectoryExists(ipmPath);

    const manifestContent = {
        kcd_mod: {
            info: {
                name: 'IPM Tool',
                modid: 'ipmtool',
                description: 'App to merge xml inventorypreset',
                author: 'cgize',
                version: '1.0',
                created_on: '',
                modifies_level: 'false'
            }
        }
    };

    const builder = new xml2js.Builder({
        renderOpts: { pretty: true, indent: '\t' },
        xmldec: { version: '1.0', encoding: 'us-ascii' }
    });

    const xml = builder.buildObject(manifestContent);
    await fs.writeFile(path.join(ipmPath, 'mod.manifest'), xml);
}

async function updateModOrder(modsPath) {
    const modOrderPath = path.join(modsPath, 'mod_order.txt');
    try {
        let modOrder = await fs.readFile(modOrderPath, 'utf8');
        if (!modOrder.includes('ipmtool')) {
            modOrder += '\nipmtool';
            await fs.writeFile(modOrderPath, modOrder.trim());
        }
    } catch (e) {
        // Si el archivo no existe, simplemente no hacemos nada.
        if (e.code !== 'ENOENT') throw e;
    }
}

// Función principal
async function searchAndMerge(modsPath, options = {}) {
    const logger = new Logger();
    const { onProcessingFile, combineOnlyConflicts = false } = options;
    
    try {
        logger.info(`Starting process in: ${modsPath}`);
        const modOrder = await getModOrder(modsPath);
        logger.info(`Detected mod order: ${modOrder.join(', ') || 'None'}`);

        const pakFiles = await findPakFiles(modsPath);
        logger.pakFiles = pakFiles;
        logger.info(`PAK files found: ${pakFiles.length}`);

        if (pakFiles.length === 0) {
            throw new Error('No PAK files were found in the specified path');
        }

        const { xmls: xmlFiles, modIds } = await extractRelevantXmls(pakFiles, modOrder, (fileName) => {
            logger.xmlFiles.push(fileName);
            onProcessingFile?.(fileName);
        });

        xmlFiles.forEach(xml => {
            const modData = logger.combinedMods.get(xml.modId) || { priority: xml.priority, xmls: [] };
            modData.xmls.push(xml.fileName);
            logger.combinedMods.set(xml.modId, modData);
        });

        logger.info(`Relevant XMLs processed: ${xmlFiles.length}`);
        
        if (xmlFiles.length === 0) {
            throw new Error('No relevant XML files were found in the PAKs');
        }

        const combinedXml = await combineXmls(xmlFiles, combineOnlyConflicts);
        await createIpmPak(combinedXml, modsPath);
        await createModManifest(modsPath);
        await updateModOrder(modsPath);

        logger.info('Process completed successfully');
        
        return { 
            success: true, 
            message: 'Ipmtool .pak file has been created and mod_order updated.',
            combinedMods: modIds,
            logContent: logger.getLogContent()
        };
    } catch (error) {
        logger.error(`${error.message}`);
        console.error(error);
        return {
            success: false,
            message: `${error.message}`,
            logContent: logger.getLogContent()
        };
    }
}

module.exports = { searchAndMerge };