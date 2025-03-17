// xmlCombiner.js
// Módulo para combinar y fusionar archivos XML de inventario

const { XMLParser, XMLBuilder } = require('fast-xml-parser');
const config = require('./config');
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
        if (key.startsWith(config.XML.ATTRIBUTE_PREFIX)) {
            combinedAttributes[key] = highestPriorityPreset[key];
        }
    }
    
    return combinedAttributes;
}

/**
 * Procesa y organiza presets de XMLs en un mapa
 * @param {Array} xmlFiles - Lista de archivos XML con metadatos
 * @param {XMLParser} parser - Instancia del parser XML
 * @returns {Object} - Mapa de presets y set de mods contribuyentes
 */
function processXmlsIntoPresets(xmlFiles, parser) {
    const presetMap = new Map();
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

    return { presetMap, contributingModIds };
}

/**
 * Selecciona y fusiona presets según el método de resolución
 * @param {Map} presetMap - Mapa de presets por nombre
 * @param {string} resolutionMethod - Método de resolución de conflictos
 * @param {boolean} combineOnlyConflicts - Si solo se deben incluir presets en conflicto
 * @returns {Object} - Presets seleccionados y mods incluidos
 */
function selectAndMergePresets(presetMap, resolutionMethod, combineOnlyConflicts) {
    const selectedPresets = [];
    const includedModIds = new Set();
    
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

    // Filtrar presets si solo queremos los que tienen conflictos
    let finalPresets = selectedPresets;
    if (combineOnlyConflicts) {
        finalPresets = selectedPresets.filter(preset => {
            const presetsForName = presetMap.get(preset[config.XML.NAME_ATTRIBUTE]);
            return presetsForName.length > 1;
        });
        
        // Actualizar la lista de mods incluidos para que solo contenga los que tienen conflictos
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

    return { finalPresets, includedModIds };
}

/**
 * Genera el XML combinado con la estructura final
 * @param {Array} finalPresets - Lista de presets finales
 * @param {XMLBuilder} builder - Instancia del constructor XML
 * @returns {string} - XML combinado como string
 */
function generateCombinedXml(finalPresets, builder) {
    // Aseguramos que finalPresets sea siempre un array
    const presetsArray = finalPresets.length === 0 ? [] : finalPresets;

    // Estructura del documento XML final
    const combinedXml = {
        database: {
            "@_xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
            "@_name": "barbora",
            "@_xsi:noNamespaceSchemaLocation": "InventoryPreset.xsd",
            InventoryPresets: {
                "@_version": "2",
                "@_Mode": "All",  // Añadir Mode="All" como especificaste
                "@_Health": "1",  // Añadir Health="1" como especificaste
                // Asegurarse de que cada preset tenga sus PresetItem configurados correctamente
                InventoryPreset: presetsArray.map(preset => {
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

    return builder.build(combinedXml);
}

/**
 * Combina XMLs de inventario según las opciones especificadas
 * @param {Array} xmlFiles - Lista de archivos XML con metadatos
 * @param {Object} options - Opciones de combinación
 * @returns {Object} - Objeto con el XML combinado y los IDs de mods incluidos
 */
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

    const { 
        combineOnlyConflicts = false, 
        manualModOrder = null,
        resolutionMethod = config.RESOLUTION_METHODS.MANUAL
    } = options;

    // Si hay un orden manual, aplicarlo a los XMLs
    let processedXmlFiles = xmlFiles;
    if (resolutionMethod === config.RESOLUTION_METHODS.MANUAL && manualModOrder && manualModOrder.length > 0) {
        processedXmlFiles = applyManualModOrder(xmlFiles, manualModOrder);
    }

    // Procesar XMLs y organizar presets
    const { presetMap, contributingModIds } = processXmlsIntoPresets(processedXmlFiles, parser);

    // Seleccionar y fusionar presets
    const { finalPresets, includedModIds } = selectAndMergePresets(
        presetMap, 
        resolutionMethod, 
        combineOnlyConflicts
    );

    // Generar el XML final
    const combinedXml = generateCombinedXml(finalPresets, builder);

    return {
        xml: combinedXml,
        includedModIds: Array.from(includedModIds)
    };
}

module.exports = {
    combineXmls,
    // Exportamos también estas funciones para pruebas unitarias
    combinePresetAttributes,
    processXmlsIntoPresets,
    selectAndMergePresets,
    generateCombinedXml
};