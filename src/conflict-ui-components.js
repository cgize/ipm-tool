// conflict-ui-components.js
// Funciones para crear componentes de UI para el diálogo de conflictos

const { 
    createModListItem, 
    updatePriorityIndicators, 
    getDragAfterElement, 
    enableDragAndDrop 
} = require('./conflict-utils');

// Variable global para almacenar los detalles de los mods
// Esta variable será alimentada desde conflict-dialog.js
let modDetails = [];

/**
 * Crea el elemento de visualización de un item en conflicto
 * @param {Object} item - Datos del item en conflicto
 * @returns {HTMLElement} - Elemento DOM que representa el item
 */
function createConflictItemElement(item) {
    // Verificar que el item tenga datos válidos
    if (!item || !item.name) {
        console.error('Item inválido:', item);
        return document.createElement('div');
    }
    
    const itemDiv = document.createElement('div');
    itemDiv.className = 'conflict-item';
    
    // Mostrar nombre del ítem
    const itemNameDiv = document.createElement('div');
    itemNameDiv.className = 'conflict-item-name';
    itemNameDiv.textContent = item.name;
    itemDiv.appendChild(itemNameDiv);
    
    // Mostrar el nombre del InventoryPreset (nodo padre) si está disponible
    if (item.parentPreset) {
        const parentPresetDiv = document.createElement('div');
        parentPresetDiv.className = 'parent-preset-name';
        parentPresetDiv.textContent = `Preset: ${item.parentPreset}`;
        itemDiv.appendChild(parentPresetDiv);
    }
    
    // Mostrar los valores en conflicto en formato vertical compacto
    if (item.values && item.values.length >= 2) {
        const valuesContainer = document.createElement('div');
        valuesContainer.className = 'conflict-item-values';
        
        // Ordenar los valores (descendente para valores numéricos)
        const sortedValues = [...item.values].sort((a, b) => {
            // Ordenar primero por Count (si existe)
            if (a.count !== undefined && b.count !== undefined) {
                return parseFloat(b.count) - parseFloat(a.count);
            }
            // Luego por Amount (si existe)
            if (a.amount !== undefined && b.amount !== undefined) {
                return parseFloat(b.amount) - parseFloat(a.amount);
            }
            // Finalmente por Value (si existe)
            if (a.value !== undefined && b.value !== undefined) {
                return parseFloat(b.value) - parseFloat(a.value);
            }
            return 0;
        });
        
        // Crear lista vertical compacta
        const valuesList = document.createElement('ul');
        valuesList.className = 'compact-values-list';
        
        sortedValues.forEach(value => {
            const valueItem = document.createElement('li');
            valueItem.className = 'compact-value-item';
            
            // Contenedor para el mod ID y su valor
            const modContainer = document.createElement('div');
            modContainer.className = 'mod-value-container';
            
            // Mostrar el ID del mod
            const modIdSpan = document.createElement('span');
            modIdSpan.className = 'mod-id';
            modIdSpan.textContent = value.modId || "Desconocido";
            modContainer.appendChild(modIdSpan);
            
            // Mostrar valores relevantes
            if (value.count !== undefined) {
                const countSpan = document.createElement('span');
                countSpan.className = 'value-badge count';
                countSpan.textContent = `Count: ${value.count}`;
                modContainer.appendChild(countSpan);
            }
            
            if (value.amount !== undefined) {
                const amountSpan = document.createElement('span');
                amountSpan.className = 'value-badge amount';
                amountSpan.textContent = `Amount: ${value.amount}`;
                modContainer.appendChild(amountSpan);
            }
            
            if (value.value !== undefined) {
                const valueSpan = document.createElement('span');
                valueSpan.className = 'value-badge value';
                valueSpan.textContent = `Value: ${value.value}`;
                modContainer.appendChild(valueSpan);
            }
            
            valueItem.appendChild(modContainer);
            valuesList.appendChild(valueItem);
        });
        
        valuesContainer.appendChild(valuesList);
        itemDiv.appendChild(valuesContainer);
    }
    
    return itemDiv;
}

/**
 * Crea una versión compacta del elemento de visualización para un item en conflicto
 * @param {Object} item - Datos del item en conflicto
 * @returns {HTMLElement} - Elemento DOM compacto para el item
 */
function createCompactConflictItem(item) {
    const itemContainer = document.createElement('div');
    itemContainer.className = 'compact-conflict-item';
    
    // Nombre del item
    const itemName = document.createElement('div');
    itemName.className = 'item-name';
    itemName.textContent = item.name;
    itemContainer.appendChild(itemName);
    
    // Ordenar los valores (descendente para valores numéricos)
    if (item.values && item.values.length > 0) {
        const sortedValues = [...item.values].sort((a, b) => {
            // Ordenar primero por Count (si existe)
            if (a.count !== undefined && b.count !== undefined) {
                return parseFloat(b.count) - parseFloat(a.count);
            }
            // Luego por Amount (si existe)
            if (a.amount !== undefined && b.amount !== undefined) {
                return parseFloat(b.amount) - parseFloat(a.amount);
            }
            // Finalmente por Value (si existe)
            if (a.value !== undefined && b.value !== undefined) {
                return parseFloat(b.value) - parseFloat(a.value);
            }
            return 0;
        });
        
        // Valores compactos
        const valuesList = document.createElement('ul');
        valuesList.className = 'values-list';
        
        sortedValues.forEach(value => {
            const valueItem = document.createElement('li');
            valueItem.className = 'value-item';
            
            // ID del mod
            const modId = document.createElement('span');
            modId.className = 'mod-id';
            modId.textContent = value.modId || "Desconocido";
            valueItem.appendChild(modId);
            
            // Contenedor de valores
            const valuesContainer = document.createElement('div');
            valuesContainer.className = 'values-container';
            
            // Añadir los valores que existan
            if (value.count !== undefined) {
                addValueBadge(valuesContainer, 'count', value.count);
            }
            if (value.amount !== undefined) {
                addValueBadge(valuesContainer, 'amount', value.amount);
            }
            if (value.value !== undefined) {
                addValueBadge(valuesContainer, 'value', value.value);
            }
            
            valueItem.appendChild(valuesContainer);
            valuesList.appendChild(valueItem);
        });
        
        itemContainer.appendChild(valuesList);
    }
    
    return itemContainer;
}

/**
 * Agrupa y crea los elementos de visualización para los items en conflicto
 * @param {Array} items - Lista de items en conflicto
 * @returns {HTMLElement} - Contenedor con los items agrupados por preset
 */
function createGroupedConflictItems(items) {
    const container = document.createElement('div');
    container.className = 'grouped-conflict-items';
    
    // Agrupar los items por su preset padre
    const groupedByPreset = {};
    items.forEach(item => {
        const presetName = item.parentPreset || 'Sin preset';
        if (!groupedByPreset[presetName]) {
            groupedByPreset[presetName] = [];
        }
        groupedByPreset[presetName].push(item);
    });
    
    // Crear secciones para cada grupo de preset
    for (const [presetName, presetItems] of Object.entries(groupedByPreset)) {
        const presetGroup = document.createElement('div');
        presetGroup.className = 'preset-group';
        
        // Encabezado del preset
        const presetHeader = document.createElement('div');
        presetHeader.className = 'preset-header';
        presetHeader.textContent = `Preset: ${presetName}`;
        presetGroup.appendChild(presetHeader);
        
        // Lista de items para este preset
        const itemsList = document.createElement('div');
        itemsList.className = 'items-list';
        
        // Agregar cada item
        presetItems.forEach(item => {
            const itemElement = createCompactConflictItem(item);
            itemsList.appendChild(itemElement);
        });
        
        presetGroup.appendChild(itemsList);
        container.appendChild(presetGroup);
    }
    
    return container;
}

/**
 * Agrega una insignia de valor al contenedor especificado
 * @param {HTMLElement} container - Contenedor donde agregar la insignia
 * @param {string} type - Tipo de valor (count, amount, value)
 * @param {string|number} value - Valor a mostrar
 */
function addValueBadge(container, type, value) {
    const badge = document.createElement('span');
    badge.className = `value-badge ${type}`;
    badge.textContent = `${type.charAt(0).toUpperCase() + type.slice(1)}: ${value}`;
    container.appendChild(badge);
}

/**
 * Crea un elemento para un grupo de conflictos
 * @param {Object} group - Grupo de conflictos
 * @param {number} groupIndex - Índice del grupo
 * @returns {HTMLElement} - Elemento DOM que representa el grupo
 */
function createConflictGroupElement(group, groupIndex) {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'conflict-group';
    
    // Título del grupo
    const headerDiv = document.createElement('div');
    headerDiv.className = 'conflict-header';
    headerDiv.textContent = `Grupo de Conflicto ${groupIndex}: ${group.mods.length} Mods`;
    groupDiv.appendChild(headerDiv);
    
    // Descripción
    const descDiv = document.createElement('div');
    descDiv.className = 'conflict-description';
    descDiv.textContent = `Estos mods modifican ${group.items.length} items con valores diferentes. Arrastra para establecer el orden de prioridad.`;
    groupDiv.appendChild(descDiv);
    
    // Usar la nueva función para mostrar items agrupados
    const itemsContainer = document.createElement('div');
    itemsContainer.className = 'conflict-preview compact-view';
    
    // Agrupar items por preset para una visualización más organizada
    const groupedItems = groupItemsByPreset(group.items);
    
    // Inicialmente limitar a mostrar solo algunos presets
    const presetsToShowInitially = 2; // mostrar los primeros 2 presets inicialmente
    const visiblePresets = Object.entries(groupedItems).slice(0, presetsToShowInitially);
    const hiddenPresets = Object.entries(groupedItems).slice(presetsToShowInitially);
    
    // Crear elementos para los presets visibles inicialmente
    visiblePresets.forEach(([presetName, items]) => {
        const presetGroup = createPresetGroup(presetName, items);
        itemsContainer.appendChild(presetGroup);
    });
    
    groupDiv.appendChild(itemsContainer);
    
    // Si hay más presets, agregar un contenedor oculto y un botón para mostrar/ocultar
    if (hiddenPresets.length > 0) {
        // Crear contenedor para presets ocultos
        const hiddenItemsContainer = document.createElement('div');
        hiddenItemsContainer.className = 'hidden-items-container';
        hiddenItemsContainer.style.display = 'none';
        
        // Añadir los presets ocultos
        hiddenPresets.forEach(([presetName, items]) => {
            const presetGroup = createPresetGroup(presetName, items);
            hiddenItemsContainer.appendChild(presetGroup);
        });
        
        groupDiv.appendChild(hiddenItemsContainer);
        
        // Botón para mostrar/ocultar más presets
        let totalHiddenItems = hiddenPresets.reduce((total, [_, items]) => total + items.length, 0);
        
        const showMoreBtn = document.createElement('button');
        showMoreBtn.className = 'show-more-btn';
        showMoreBtn.textContent = `Mostrar ${totalHiddenItems} items más de ${hiddenPresets.length} presets...`;
        
        let additionalItemsVisible = false;
        showMoreBtn.addEventListener('click', function() {
            additionalItemsVisible = !additionalItemsVisible;
            hiddenItemsContainer.style.display = additionalItemsVisible ? 'flex' : 'none';
            this.textContent = additionalItemsVisible 
                ? 'Ocultar items adicionales' 
                : `Mostrar ${totalHiddenItems} items más de ${hiddenPresets.length} presets...`;
        });
        
        groupDiv.appendChild(showMoreBtn);
    }
    
    // Lista de mods para ordenar
    const modListUl = createModsOrderList(group.mods, groupIndex);
    groupDiv.appendChild(modListUl);
    
    // Habilitar drag & drop para este grupo
    enableDragAndDrop(modListUl);
    
    return groupDiv;
}

/**
 * Agrupa los items por su preset padre
 * @param {Array} items - Lista de items
 * @returns {Object} - Objeto con los items agrupados por preset
 */
function groupItemsByPreset(items) {
    const groupedItems = {};
    
    items.forEach(item => {
        const presetName = item.parentPreset || 'Sin preset';
        if (!groupedItems[presetName]) {
            groupedItems[presetName] = [];
        }
        groupedItems[presetName].push(item);
    });
    
    return groupedItems;
}

/**
 * Crea un grupo de preset con sus items
 * @param {string} presetName - Nombre del preset
 * @param {Array} items - Items que pertenecen a este preset
 * @returns {HTMLElement} - Elemento DOM del grupo de preset
 */
function createPresetGroup(presetName, items) {
    const presetGroup = document.createElement('div');
    presetGroup.className = 'preset-group';
    
    // Encabezado del preset
    const presetHeader = document.createElement('div');
    presetHeader.className = 'preset-header';
    presetHeader.textContent = `Preset: ${presetName}`;
    presetGroup.appendChild(presetHeader);
    
    // Lista de items
    const itemsList = document.createElement('div');
    itemsList.className = 'items-list';
    
    // Agregar cada item
    items.forEach(item => {
        const itemElement = createCompactConflictItem(item);
        itemsList.appendChild(itemElement);
    });
    
    presetGroup.appendChild(itemsList);
    return presetGroup;
}

/**
 * Crea la lista de mods para ordenarlos
 * @param {Array} mods - Lista de IDs de mods
 * @param {number} groupIndex - Índice del grupo de conflictos
 * @returns {HTMLElement} - Lista ordenable de mods
 */
function createModsOrderList(mods, groupIndex) {
    const modListUl = document.createElement('ul');
    modListUl.className = 'mod-priority-list';
    modListUl.id = `mod-list-${groupIndex}`;
    
    // Ordenar los mods: los que están en modDetails primero, luego el resto
    const modsToDisplay = [...mods].sort((a, b) => {
        const modA = getModDetails(a.modId);
        const modB = getModDetails(b.modId);
        
        // Si ambos tienen detalles, ordenar por prioridad (si existe)
        if (modA && modB) {
            // Mayor prioridad primero (números mayores)
            return (modB.priority || -1) - (modA.priority || -1);
        }
        
        // Si solo uno tiene detalles, ponerlo primero
        if (modA) return -1;
        if (modB) return 1;
        
        // Orden alfabético si no hay criterio mejor
        return a.modId.localeCompare(b.modId);
    });
    
    // Crear los elementos de la lista para cada mod
    modsToDisplay.forEach((mod, index) => {
        const modDetailInfo = getModDetails(mod.modId);
        const modItemLi = createModListItem(mod.modId, modDetailInfo, index === 0, moveItem);
        modListUl.appendChild(modItemLi);
    });
    
    return modListUl;
}

/**
 * Obtiene los detalles de un mod por su ID
 * @param {string} modId - ID del mod
 * @returns {Object|null} - Detalles del mod o null si no se encuentra
 */
function getModDetails(modId) {
    return modDetails.find(mod => mod.id === modId);
}

/**
 * Establece los detalles de los mods para uso en funciones UI
 * @param {Array} details - Array con detalles de los mods
 */
function setModDetails(details) {
    modDetails = details || [];
}

// Exportar todas las funciones del módulo
module.exports = {
    createConflictItemElement,
    createCompactConflictItem,
    createGroupedConflictItems,
    createConflictGroupElement,
    setModDetails,
    getModDetails
};