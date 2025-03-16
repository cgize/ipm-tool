// conflict-manager.js
// Módulo mejorado para manejar la detección y resolución de conflictos entre mods

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
                        value: mv.value,
                        parentPreset: mv.parentPreset
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

/**
 * Extrae valores de los items de un archivo XML para detectar conflictos
 * @param {string} xmlContent - Contenido del archivo XML
 * @param {string} modId - ID del mod
 * @param {Map} modDetails - Mapa con detalles de los mods
 * @param {Map} conflictItemValues - Mapa para detectar conflictos
 */
function extractItemValues(xmlContent, modId, modDetails, conflictItemValues) {
    const { XMLParser } = require('fast-xml-parser');
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
                const count = item["@_Count"];
                const amount = item["@_Amount"];
                const value = item["@_Value"];
                
                // Almacenar los valores en los detalles del mod
                if (modDetails.has(modId)) {
                    if (!modDetails.get(modId).presetItems.has(itemName)) {
                        modDetails.get(modId).presetItems.set(itemName, {
                            count, 
                            amount,
                            value,
                            parentPreset: presetName
                        });
                    }
                }
                
                // Registrar el item para detectar conflictos
                if (count !== undefined || amount !== undefined || value !== undefined) {
                    if (!conflictItemValues.has(itemName)) {
                        conflictItemValues.set(itemName, []);
                    }
                    
                    conflictItemValues.get(itemName).push({
                        modId,
                        count,
                        amount,
                        value,
                        parentPreset: presetName
                    });
                }
            }
        }
    } catch (error) {
        console.error("Error parsing XML content:", error);
    }
}

/**
 * Actualiza la prioridad de los XMLs según el orden manual proporcionado
 * @param {Array} xmlFiles - Lista de archivos XML con metadata
 * @param {Array} manualModOrder - Orden manual de prioridad de mods
 * @returns {Array} - Lista actualizada de archivos XML con prioridades actualizadas
 */
function applyManualModOrder(xmlFiles, manualModOrder) {
    if (!manualModOrder || manualModOrder.length === 0) {
        return xmlFiles;
    }

    const updatedXmls = [...xmlFiles];
    
    for (const xmlFile of updatedXmls) {
        const modIndex = manualModOrder.indexOf(xmlFile.modId);
        if (modIndex !== -1) {
            // Prioridad inversa: el índice 0 (primera posición) es la más alta prioridad
            xmlFile.priority = manualModOrder.length - modIndex;
        }
    }
    
    // Reordenar los XMLs según la nueva prioridad
    updatedXmls.sort((a, b) => b.priority - a.priority);
    
    return updatedXmls;
}

/**
 * Fusiona items de presets por prioridad (método original)
 * @param {Array} presetObjs - Lista de objetos preset con sus prioridades
 * @returns {Array} - Lista de items fusionados
 */
function mergePresetItemsByPriority(presetObjs) {
    // Ordenamos los presets por prioridad (el número más bajo indica mayor prioridad)
    const sortedPresets = [...presetObjs].sort((a, b) => a.priority - b.priority);
    
    // Creamos un mapa para almacenar todos los PresetItems por su nombre
    const itemMap = new Map();
    
    // Procesamos todos los presets en orden de prioridad (de mayor a menor)
    for (const presetObj of sortedPresets) {
        // Extraemos el preset actual
        const preset = presetObj.preset;
        
        // Obtenemos todos los items del preset
        const presetItems = preset.PresetItem || [];
        const itemArray = Array.isArray(presetItems) ? presetItems : [presetItems];
        
        // Procesamos cada PresetItem
        for (const item of itemArray) {
            const itemName = item["@_Name"];
            if (!itemName) continue;
            
            // Si este item no existe ya en el mapa, lo añadimos
            // Esto preserva los items del mod con mayor prioridad y añade items únicos
            // de mods con menor prioridad
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

/**
 * Fusiona items de presets eligiendo el valor más alto para cada atributo
 * @param {Array} presetObjs - Lista de objetos preset con sus prioridades
 * @returns {Array} - Lista de items fusionados con los valores más altos
 */
function mergePresetItemsByHighestValue(presetObjs) {
    // Creamos un mapa para almacenar todos los PresetItems por su nombre
    const itemMap = new Map();
    
    // Procesamos todos los presets para encontrar cada item único
    for (const presetObj of presetObjs) {
        const preset = presetObj.preset;
        const presetItems = preset.PresetItem || [];
        const itemArray = Array.isArray(presetItems) ? presetItems : [presetItems];
        
        for (const item of itemArray) {
            const itemName = item["@_Name"];
            if (!itemName) continue;
            
            if (!itemMap.has(itemName)) {
                // Si es la primera vez que vemos este item, simplemente lo agregamos
                itemMap.set(itemName, JSON.parse(JSON.stringify(item)));
            } else {
                // Si el item ya existe, comparamos valores
                const existingItem = itemMap.get(itemName);
                
                // Comparar y quedarnos con el COUNT mayor
                if (item["@_Count"] !== undefined && existingItem["@_Count"] !== undefined) {
                    const newCount = parseFloat(item["@_Count"]);
                    const existingCount = parseFloat(existingItem["@_Count"]);
                    if (!isNaN(newCount) && !isNaN(existingCount) && newCount > existingCount) {
                        existingItem["@_Count"] = item["@_Count"];
                    }
                } else if (item["@_Count"] !== undefined) {
                    existingItem["@_Count"] = item["@_Count"];
                }
                
                // Comparar y quedarnos con el AMOUNT mayor
                if (item["@_Amount"] !== undefined && existingItem["@_Amount"] !== undefined) {
                    const newAmount = parseFloat(item["@_Amount"]);
                    const existingAmount = parseFloat(existingItem["@_Amount"]);
                    if (!isNaN(newAmount) && !isNaN(existingAmount) && newAmount > existingAmount) {
                        existingItem["@_Amount"] = item["@_Amount"];
                    }
                } else if (item["@_Amount"] !== undefined) {
                    existingItem["@_Amount"] = item["@_Amount"];
                }
                
                // Comparar y quedarnos con el VALUE mayor
                if (item["@_Value"] !== undefined && existingItem["@_Value"] !== undefined) {
                    const newValue = parseFloat(item["@_Value"]);
                    const existingValue = parseFloat(existingItem["@_Value"]);
                    if (!isNaN(newValue) && !isNaN(existingValue) && newValue > existingValue) {
                        existingItem["@_Value"] = item["@_Value"];
                    }
                } else if (item["@_Value"] !== undefined) {
                    existingItem["@_Value"] = item["@_Value"];
                }
                
                // Para otros atributos, mantener los existentes o agregar nuevos
                for (const key in item) {
                    if (!existingItem[key] && key !== "@_Name") {
                        existingItem[key] = item[key];
                    }
                }
            }
        }
    }
    
    // Convertir el mapa a un array
    return Array.from(itemMap.values());
}

/**
 * Fusiona items de presets eligiendo el valor más bajo para cada atributo
 * @param {Array} presetObjs - Lista de objetos preset con sus prioridades
 * @returns {Array} - Lista de items fusionados con los valores más bajos
 */
function mergePresetItemsByLowestValue(presetObjs) {
    // Creamos un mapa para almacenar todos los PresetItems por su nombre
    const itemMap = new Map();
    
    // Procesamos todos los presets para encontrar cada item único
    for (const presetObj of presetObjs) {
        const preset = presetObj.preset;
        const presetItems = preset.PresetItem || [];
        const itemArray = Array.isArray(presetItems) ? presetItems : [presetItems];
        
        for (const item of itemArray) {
            const itemName = item["@_Name"];
            if (!itemName) continue;
            
            if (!itemMap.has(itemName)) {
                // Si es la primera vez que vemos este item, simplemente lo agregamos
                itemMap.set(itemName, JSON.parse(JSON.stringify(item)));
            } else {
                // Si el item ya existe, comparamos valores
                const existingItem = itemMap.get(itemName);
                
                // Comparar y quedarnos con el COUNT menor
                if (item["@_Count"] !== undefined && existingItem["@_Count"] !== undefined) {
                    const newCount = parseFloat(item["@_Count"]);
                    const existingCount = parseFloat(existingItem["@_Count"]);
                    if (!isNaN(newCount) && !isNaN(existingCount) && newCount < existingCount) {
                        existingItem["@_Count"] = item["@_Count"];
                    }
                } else if (item["@_Count"] !== undefined) {
                    existingItem["@_Count"] = item["@_Count"];
                }
                
                // Comparar y quedarnos con el AMOUNT menor
                if (item["@_Amount"] !== undefined && existingItem["@_Amount"] !== undefined) {
                    const newAmount = parseFloat(item["@_Amount"]);
                    const existingAmount = parseFloat(existingItem["@_Amount"]);
                    if (!isNaN(newAmount) && !isNaN(existingAmount) && newAmount < existingAmount) {
                        existingItem["@_Amount"] = item["@_Amount"];
                    }
                } else if (item["@_Amount"] !== undefined) {
                    existingItem["@_Amount"] = item["@_Amount"];
                }
                
                // Comparar y quedarnos con el VALUE menor
                if (item["@_Value"] !== undefined && existingItem["@_Value"] !== undefined) {
                    const newValue = parseFloat(item["@_Value"]);
                    const existingValue = parseFloat(existingItem["@_Value"]);
                    if (!isNaN(newValue) && !isNaN(existingValue) && newValue < existingValue) {
                        existingItem["@_Value"] = item["@_Value"];
                    }
                } else if (item["@_Value"] !== undefined) {
                    existingItem["@_Value"] = item["@_Value"];
                }
                
                // Para otros atributos, mantener los existentes o agregar nuevos
                for (const key in item) {
                    if (!existingItem[key] && key !== "@_Name") {
                        existingItem[key] = item[key];
                    }
                }
            }
        }
    }
    
    // Convertir el mapa a un array
    return Array.from(itemMap.values());
}

/**
 * Selector de método de fusión según el método de resolución
 * @param {string} resolutionMethod - Método de resolución ('manual', 'highest-value', 'lowest-value')
 * @param {Array} presetObjs - Lista de objetos preset con sus prioridades
 * @returns {Array} - Lista de items fusionados según el método seleccionado
 */
function mergePresetItems(presetObjs, resolutionMethod = 'manual') {
    switch(resolutionMethod) {
        case 'highest-value':
            return mergePresetItemsByHighestValue(presetObjs);
        case 'lowest-value':
            return mergePresetItemsByLowestValue(presetObjs);
        case 'manual':
        default:
            return mergePresetItemsByPriority(presetObjs);
    }
}

module.exports = {
    detectModConflicts,
    extractItemValues,
    applyManualModOrder,
    mergePresetItems
};