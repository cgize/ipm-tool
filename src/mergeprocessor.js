const fs = require('fs').promises;
const path = require('path');
const yauzl = require('yauzl');
const { XMLParser, XMLBuilder } = require('fast-xml-parser');
const AdmZip = require('adm-zip');
const Logger = require('./logger');
const { findPakFiles, getModOrder, extractModIdFromPak, extractRelevantXmls } = require('./fileUtils');

// Función para combinar XMLs
async function combineXmls(xmlFiles, combineOnlyConflicts = false) {
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

    function mergePresetItems(presetObjs) {
        // Ordenamos los presets por prioridad (el número más bajo indica mayor prioridad)
        const sortedPresets = [...presetObjs].sort((a, b) => a.priority - b.priority);
        
        // Tomamos el preset base del mod con mayor prioridad
        const basePreset = sortedPresets[0];
        
        // Creamos un mapa para almacenar todos los PresetItems por su nombre
        const itemMap = new Map();
        
        // Procesamos todos los presets en orden de prioridad (de mayor a menor)
        for (const presetObj of sortedPresets) {
            const presetItems = presetObj.preset.PresetItem || [];
            const itemArray = Array.isArray(presetItems) ? presetItems : [presetItems];
            
            // Procesamos cada PresetItem
            for (const item of itemArray) {
                const itemName = item["@_Name"];
                if (!itemName) continue;
                
                // Si este item no existe en el mapa o viene de un mod con mayor prioridad,
                // lo añadimos/reemplazamos en el mapa
                if (!itemMap.has(itemName)) {
                    itemMap.set(itemName, item);
                }
                // No reemplazamos items que ya existen porque los hemos procesado
                // en orden de prioridad de mayor a menor
            }
        }
        
        // Convertimos el mapa a un array
        return Array.from(itemMap.values());
    }

    const selectedPresets = [];
    for (const [presetName, presets] of presetMap) {
        let selectedPreset;
        if (presets.length > 1) {
            // Ordenamos por prioridad (el número más bajo indica mayor prioridad)
            const sortedPresets = presets.sort((a, b) => a.priority - b.priority);
            const winnerMod = sortedPresets[0].modId;
            console.info(`CONFLICT: ${presetName} - Mods: ${presets.map(p => p.modId).join(', ')}. Winner: ${winnerMod} (Priority: ${sortedPresets[0].priority})`);
            
            // Tomamos la estructura base del mod con mayor prioridad
            selectedPreset = JSON.parse(JSON.stringify(sortedPresets[0].preset));
            
            // Fusionamos los PresetItems
            const mergedItems = mergePresetItems(presets);
            selectedPreset.PresetItem = mergedItems;
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
                "@_name": "IPM Tool",
                "@_modid": "ipmtool",
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
        if (!modOrder.includes('ipmtool')) {
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