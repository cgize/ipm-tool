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
        if (key.startsWith("@_")) {
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

    const builder = new XMLBuilder({
        ignoreAttributes: false,
        format: true,
        indentBy: "\t",
        attributeNamePrefix: "@_"
    });

    const presetMap = new Map();
    const { 
        combineOnlyConflicts = false, 
        manualModOrder = null,
        resolutionMethod = 'manual' // Método de resolución
    } = options;

    // Si hay un orden manual, aplicarlo a los XMLs
    if (resolutionMethod === 'manual' && manualModOrder && manualModOrder.length > 0) {
        xmlFiles = applyManualModOrder(xmlFiles, manualModOrder);
    }

    for (const xmlFile of xmlFiles) {
        try {
            const parsed = parser.parse(xmlFile.content);
            const database = parsed.database;
            const inventoryPresets = database?.InventoryPresets;
            const presets = inventoryPresets?.InventoryPreset;
            if (!presets) continue;
            const presetArray = Array.isArray(presets) ? presets : [presets];
            for (const preset of presetArray) {
                const presetName = preset["@_Name"];
                if (!presetName) continue;
                if (!presetMap.has(presetName)) {
                    presetMap.set(presetName, []);
                }
                presetMap.get(presetName).push({
                    preset,
                    priority: xmlFile.priority,
                    modId: xmlFile.modId
                });
            }
        } catch (err) {
            console.error(`Error processing ${xmlFile.fileName}:`, err);
        }
    }

    const selectedPresets = [];
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
        } else {
            // Si no hay conflicto, tomamos el preset tal cual
            selectedPreset = JSON.parse(JSON.stringify(presets[0].preset));
            
            // Aseguramos que PresetItem sea un array para consistencia
            const presetItems = selectedPreset.PresetItem || [];
            selectedPreset.PresetItem = Array.isArray(presetItems) ? presetItems : [presetItems];
        }
        selectedPresets.push(selectedPreset);
    }

    let finalPresets = selectedPresets;
    if (combineOnlyConflicts) {
        finalPresets = selectedPresets.filter(preset => {
            const presetsForName = presetMap.get(preset["@_Name"]);
            return presetsForName.length > 1;
        });
    }

    // Aseguramos que finalPresets sea siempre un array
    if (finalPresets.length === 0) {
        finalPresets = [];
    }

    const combinedXml = {
        database: {
            "@_xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
            "@_name": "barbora",
            "@_xsi:noNamespaceSchemaLocation": "InventoryPreset.xsd",
            InventoryPresets: {
                "@_version": "2",
                InventoryPreset: finalPresets
            }
        }
    };

    return builder.build(combinedXml);
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
    const ipmDataPath = path.join(modsPath, 'zipmtool', 'Data');
    await ensureDirectoryExists(ipmDataPath);

    const zip = new AdmZip();
    zip.addFile('Libs/Tables/item/InventoryPreset__ipmtool.xml', Buffer.from(combinedXml));

    await fs.writeFile(path.join(ipmDataPath, 'zipmtool.pak'), zip.toBuffer());
}

async function createModManifest(modsPath) {
    const ipmPath = path.join(modsPath, 'zipmtool');
    await ensureDirectoryExists(ipmPath);

    const manifestContent = {
        kcd_mod: {
            info: {
                "@_name": "IPM Tool",
                "@_modid": "zipmtool",
                "@_description": "App to merge xml inventorypreset",
                "@_author": "cgize",
                "@_version": "1.0",
                "@_created_on": "",
                "@_modifies_level": "false"
            }
        }
    };

    const builder = new XMLBuilder({
        format: true,
        indentBy: "\t",
        suppressEmptyNode: false,
        ignoreAttributes: false,
        attributeNamePrefix: "@_"
    });

    const xml = builder.build(manifestContent);
    await fs.writeFile(path.join(ipmPath, 'mod.manifest'), xml);
}

async function updateModOrder(modsPath) {
    const modOrderPath = path.join(modsPath, 'mod_order.txt');
    try {
        let modOrder = await fs.readFile(modOrderPath, 'utf8');
        if (!modOrder.includes('zipmtool')) {
            modOrder += '\nipmtool';
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
        resolutionMethod = 'manual' // Método de resolución
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
            throw new Error('No PAK files were found in the specified paths');
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
            throw new Error('No relevant XML files were found in the PAKs');
        }

        // Comprobar si necesitamos ordenación manual y no se ha seleccionado un método automático
        if (needsManualOrder && !modOrderData.exists && !manualModOrder && resolutionMethod === 'manual') {
            // Devolvemos la información necesaria para que la interfaz muestre la pantalla de priorización
            return {
                success: false,
                needsManualOrder: true,
                conflicts: conflicts,
                modDetails: Array.from(modDetails.values()),
                message: 'Se encontraron conflictos entre mods. Por favor, establece el orden de prioridad.',
                logContent: logger.getLogContent()
            };
        }

        // Si llegamos aquí, o bien no se necesita ordenación manual, o ya se ha proporcionado una resolución
        const combinedXml = await combineXmls(xmlFiles, {
            combineOnlyConflicts,
            manualModOrder,
            resolutionMethod
        });
        
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