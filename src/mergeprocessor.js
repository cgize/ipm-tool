// mergeprocessor.js
// Módulo revisado para combinar y fusionar XMLs de mods en conflicto

const fs = require('fs').promises;
const path = require('path');
const yauzl = require('yauzl');
const { XMLParser, XMLBuilder } = require('fast-xml-parser');
const AdmZip = require('adm-zip');
const Logger = require('./logger');
const { findPakFiles, getModOrder, extractModIdFromPak, extractRelevantXmls } = require('./fileUtils');
const { applyManualModOrder, mergePresetItems } = require('./conflict-manager');
const config = require('./config');

/**
 * Combina los atributos de los presets, dando prioridad al preset con mayor prioridad
 * @param {Array} presets - Lista de presets con metadatos de prioridad
 * @returns {Object} - Objeto con los atributos combinados
 */
function combinePresetAttributes(presets) {
    // Ordenar presets por prioridad (el número más bajo indica mayor prioridad)
    const sortedPresets = [...presets].sort((a, b) => a.priority - b.priority);
    
    // Extraer el preset con mayor prioridad
    const highestPriorityPreset = sortedPresets[0].preset;
    
    // Crear un objeto con todos los atributos del preset con mayor prioridad
    const combinedAttributes = {};
    
    // Copiar todos los atributos que empiezan con "@_"
    for (const key in highestPriorityPreset) {
        if (key.startsWith(config.XML.ATTRIBUTE_PREFIX)) {
            combinedAttributes[key] = highestPriorityPreset[key];
        }
    }
    
    return combinedAttributes;
}

// Función para combinar XMLs
async function combineXmls(xmlFiles, options = {}) {
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        parseTagValue: true,
        parseAttributeValue: true,
        trimValues: true,
        allowBooleanAttributes: true
    });

    // Configuración específica para asegurar la sintaxis abreviada
    const builder = new XMLBuilder({
        ignoreAttributes: false,
        format: true,
        indentBy: "\t",
        attributeNamePrefix: "@_",
        suppressEmptyNode: true,         // Clave para usar />
        closingTagForEmptyElement: false, // Clave para asegurar sintaxis />
        suppressBooleanAttributes: false  // Mantener atributos booleanos
    });

    const presetMap = new Map();
    const { 
        combineOnlyConflicts = false, 
        manualModOrder = null,
        resolutionMethod = config.RESOLUTION_METHODS.MANUAL
    } = options;

    // Si hay un orden manual, aplicarlo a los XMLs
    if (resolutionMethod === config.RESOLUTION_METHODS.MANUAL && manualModOrder && manualModOrder.length > 0) {
        xmlFiles = applyManualModOrder(xmlFiles, manualModOrder);
    }

    // Set para rastrear los IDs de los mods que realmente contribuyeron
    const contributingModIds = new Set();

    for (const xmlFile of xmlFiles) {
        try {
            const parsed = parser.parse(xmlFile.content);
            const database = parsed.database;
            const inventoryPresets = database?.InventoryPresets;
            const presets = inventoryPresets?.InventoryPreset;
            if (!presets) continue;
            const presetArray = Array.isArray(presets) ? presets : [presets];
            for (const preset of presetArray) {
                const presetName = preset[config.XML.NAME_ATTRIBUTE];
                if (!presetName) continue;
                if (!presetMap.has(presetName)) {
                    presetMap.set(presetName, []);
                }
                presetMap.get(presetName).push({
                    preset,
                    priority: xmlFile.priority,
                    modId: xmlFile.modId
                });
                
                // Registrar este mod como contribuyente
                contributingModIds.add(xmlFile.modId);
            }
        } catch (err) {
            console.error(`Error processing ${xmlFile.fileName}:`, err);
        }
    }

    const selectedPresets = [];
    const includedModIds = new Set(); // Mods que se incluyen en la salida final
    
    for (const [presetName, presets] of presetMap) {
        let selectedPreset;
        if (presets.length > 1) {
            // Ordenamos por prioridad (el número más bajo indica mayor prioridad)
            const sortedPresets = presets.sort((a, b) => a.priority - b.priority);
            const winnerMod = sortedPresets[0].modId;
            console.info(`CONFLICT: ${presetName} - Mods: ${presets.map(p => p.modId).join(', ')}. Winner: ${winnerMod} (Priority: ${sortedPresets[0].priority})`);
            
            // Combinar los atributos del preset
            const combinedAttributes = combinePresetAttributes(presets);
            
            // Usar el método de fusión seleccionado desde conflict-manager.js
            const mergedItems = mergePresetItems(presets, resolutionMethod);
            
            // Crear el preset combinado
            selectedPreset = {
                ...combinedAttributes,
                PresetItem: mergedItems
            };
            
            // Registrar todos los mods en conflicto como incluidos
            presets.forEach(p => includedModIds.add(p.modId));
        } else {
            // Si no hay conflicto, tomamos el preset tal cual
            selectedPreset = JSON.parse(JSON.stringify(presets[0].preset));
            
            // Aseguramos que PresetItem sea un array para consistencia
            const presetItems = selectedPreset.PresetItem || [];
            selectedPreset.PresetItem = Array.isArray(presetItems) ? presetItems : [presetItems];
            
            // Solo registramos este mod si no estamos en modo "solo conflictos"
            if (!combineOnlyConflicts) {
                includedModIds.add(presets[0].modId);
            }
        }
        selectedPresets.push(selectedPreset);
    }

    let finalPresets = selectedPresets;
    if (combineOnlyConflicts) {
        finalPresets = selectedPresets.filter(preset => {
            const presetsForName = presetMap.get(preset[config.XML.NAME_ATTRIBUTE]);
            return presetsForName.length > 1;
        });
        
        // Actualizar la lista de mods incluidos para que solo contenga los que tienen conflictos
        if (combineOnlyConflicts) {
            const conflictModIds = new Set();
            for (const [presetName, presets] of presetMap) {
                if (presets.length > 1) {
                    presets.forEach(p => conflictModIds.add(p.modId));
                }
            }
            // Intersección de los conjuntos
            for (const modId of includedModIds) {
                if (!conflictModIds.has(modId)) {
                    includedModIds.delete(modId);
                }
            }
        }
    }

    // Aseguramos que finalPresets sea siempre un array
    if (finalPresets.length === 0) {
        finalPresets = [];
    }

    // IMPORTANTE: Asegurarse de que los atributos Mode y Health estén presentes
    const combinedXml = {
        database: {
            "@_xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
            "@_name": "barbora",
            "@_xsi:noNamespaceSchemaLocation": "InventoryPreset.xsd",
            InventoryPresets: {
                "@_version": "2",
                "@_Mode": "All",
                "@_Health": "1",
                // Asegurarse de que cada preset tenga sus PresetItem configurados correctamente
                InventoryPreset: finalPresets.map(preset => {
                    if (preset.PresetItem && Array.isArray(preset.PresetItem)) {
                        // Asegurarse que cada PresetItem sea procesado como un nodo vacío
                        preset.PresetItem = preset.PresetItem.map(item => {
                            // Esta transformación es crítica para que el builder los trate como nodos vacíos
                            const newItem = {...item};
                            // Eliminar cualquier contenido textual para asegurar que sean nodos vacíos
                            if (newItem['#text']) {
                                delete newItem['#text'];
                            }
                            return newItem;
                        });
                    }
                    return preset;
                })
            }
        }
    };

    return {
        xml: builder.build(combinedXml),
        includedModIds: Array.from(includedModIds)
    };
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
    const ipmDataPath = path.join(modsPath, config.PATHS.OUTPUT_FOLDER, config.PATHS.DATA_PATH);
    await ensureDirectoryExists(ipmDataPath);

    const zip = new AdmZip();
    zip.addFile(config.FILES.OUTPUT_XML_NAME, Buffer.from(combinedXml));

    await fs.writeFile(path.join(ipmDataPath, config.FILES.OUTPUT_PAK_NAME), zip.toBuffer());
}

async function createModManifest(modsPath) {
    // Construye la ruta completa donde se guardará el mod
    const ipmPath = path.join(modsPath, config.PATHS.OUTPUT_FOLDER);
    // Crea los directorios necesarios si no existen
    await ensureDirectoryExists(ipmPath);

    // Define la estructura del archivo mod.manifest
    // Esta estructura sigue el formato estándar requerido por el juego
    const manifestContent = {
        kcd_mod: {
            info: {
                "name": config.MOD_INFO.NAME,
                "modid": config.MOD_INFO.MOD_ID,
                "description": config.MOD_INFO.DESCRIPTION,
                "author": config.MOD_INFO.AUTHOR,
                "version": config.MOD_INFO.VERSION,
                "created_on": "",
                "modifies_level": config.MOD_INFO.MODIFIES_LEVEL
            }
        }
    };

    // Configura el generador de XML con los parámetros adecuados
    // para producir un documento XML bien formateado
    const builder = new XMLBuilder({
        format: true,               // Aplica formato legible con saltos de línea
        indentBy: "\t",             // Usa tabulaciones para indentar
        suppressEmptyNode: true,    // Optimiza nodos vacíos
        closingTagForEmptyElement: false, // Usa formato <tag/> para elementos vacíos
        ignoreAttributes: false,    // Procesa atributos XML
        attributeNamePrefix: "@_"   // Prefijo para distinguir atributos
    });

    // Agrega la declaración XML al inicio del documento
    // Requerida para que el juego reconozca correctamente el archivo
    let xml = '<?xml version="1.0" encoding="us-ascii"?>\n';
    xml += builder.build(manifestContent);
    
    // Guarda el archivo manifest en la ubicación del mod
    await fs.writeFile(path.join(ipmPath, 'mod.manifest'), xml);
}

async function updateModOrder(modsPath) {
    const modOrderPath = path.join(modsPath, config.PATHS.MOD_ORDER_FILE);
    try {
        let modOrder = await fs.readFile(modOrderPath, 'utf8');
        if (!modOrder.includes(config.MODS.TOOL_MOD_ID)) {
            modOrder += `\n${config.MODS.TOOL_MOD_ID}`;
            await fs.writeFile(modOrderPath, modOrder.trim());
        }
    } catch (e) {
        if (e.code !== 'ENOENT') throw e;
    }
}

// Función principal
async function searchAndMerge(modsPath, options = {}) {
    const logger = new Logger();
    const { 
        onProcessingFile, 
        combineOnlyConflicts = false, 
        steamModsPath = null,
        manualModOrder = null,
        resolutionMethod = config.RESOLUTION_METHODS.MANUAL
    } = options;

    try {
        logger.info(`Starting process in: ${modsPath}`);
        logger.info(`Resolution method: ${resolutionMethod}`);
        
        // Si se proporciona una ruta de Steam Workshop, la registramos en el log
        if (steamModsPath) {
            logger.info(`Including Steam Workshop mods from: ${steamModsPath}`);
        }
        
        const modOrderData = await getModOrder(modsPath);
        logger.info(`Detected mod order: ${modOrderData.modOrder.join(', ') || 'None'}`);
        logger.info(`Mod order file exists: ${modOrderData.exists ? 'Yes' : 'No'}`);

        // Pasamos la ruta de Steam Workshop a findPakFiles
        const pakFiles = await findPakFiles(modsPath, steamModsPath);
        logger.pakFiles = pakFiles;
        logger.info(`PAK files found: ${pakFiles.length}`);

        if (pakFiles.length === 0) {
            throw new Error(config.MESSAGES.NO_PAKS_FOUND);
        }

        const extractResult = await extractRelevantXmls(pakFiles, modOrderData, (fileName) => {
            logger.xmlFiles.push(fileName);
            onProcessingFile?.(fileName);
        });

        const { xmls: xmlFiles, modIds, conflicts, needsManualOrder, modDetails } = extractResult;

        xmlFiles.forEach(xml => {
            const modData = logger.combinedMods.get(xml.modId) || { priority: xml.priority, xmls: [] };
            modData.xmls.push(xml.fileName);
            logger.combinedMods.set(xml.modId, modData);
        });

        logger.info(`Relevant XMLs processed: ${xmlFiles.length}`);
        logger.info(`Conflicts detected: ${conflicts.length}`);

        if (xmlFiles.length === 0) {
            throw new Error(config.MESSAGES.NO_XML_FOUND);
        }

        // Comprobar si necesitamos ordenación manual y no se ha seleccionado un método automático
        if (needsManualOrder && !modOrderData.exists && !manualModOrder && resolutionMethod === config.RESOLUTION_METHODS.MANUAL) {
            // Devolvemos la información necesaria para que la interfaz muestre la pantalla de priorización
            return {
                success: false,
                needsManualOrder: true,
                conflicts: conflicts,
                modDetails: Array.from(modDetails.values()),
                message: config.MESSAGES.CONFLICTS_DETECTED,
                logContent: logger.getLogContent()
            };
        }

        // Si llegamos aquí, o bien no se necesita ordenación manual, o ya se ha proporcionado una resolución
        const result = await combineXmls(xmlFiles, {
            combineOnlyConflicts,
            manualModOrder,
            resolutionMethod
        });
        
        const combinedXml = result.xml;
        const includedModIds = result.includedModIds;
        
        await createIpmPak(combinedXml, modsPath);
        await createModManifest(modsPath);
        await updateModOrder(modsPath);

        // Si se ha usado un orden manual, lo registramos en el log
        if (manualModOrder && manualModOrder.length > 0) {
            logger.setManualOrder(manualModOrder);
            logger.info(`Used manual mod order: ${manualModOrder.join(', ')}`);
        }
        
        // Registrar el método de resolución utilizado
        logger.info(`Used resolution method: ${resolutionMethod}`);
        
        // Registrar los mods que se combinaron realmente
        logger.info(`Mods included in the combined output: ${includedModIds.join(', ')}`);

        logger.info('Process completed successfully');

        return {
            success: true,
            message: config.MESSAGES.PROCESS_COMPLETED,
            combinedMods: includedModIds, // Ahora solo devolvemos los mods incluidos realmente
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