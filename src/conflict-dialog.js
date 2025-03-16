// conflict-dialog.js
const { ipcRenderer } = require('electron');
const remote = require('@electron/remote');
const { 
    createConflictItemElement, 
    createModListItem, 
    updatePriorityIndicators, 
    getDragAfterElement 
} = require('./conflict-ui-components');

let conflicts = [];
let modDetails = [];
let selectedOrder = [];
let initialDataReceived = false;

document.addEventListener('DOMContentLoaded', () => {
    initWindowControls();
    initActionButtons();
    
    // Recibir datos de conflictos desde el proceso principal
    ipcRenderer.on('conflict-data', (event, data) => {
        conflicts = data.conflicts || [];
        modDetails = data.modDetails || [];
        initialDataReceived = true;
        
        // Asegurar que los datos sean válidos antes de renderizar
        if (conflicts.length > 0) {
            // Generar la interfaz de usuario para los conflictos
            renderConflicts();
        } else {
            // Si no hay conflictos, mostrar un mensaje
            console.error('No se recibieron datos de conflictos válidos');
            showNoConflictsMessage();
        }
    });
    
    // Solicitar explícitamente los datos en caso de que se hayan enviado antes de estar listo
    setTimeout(() => {
        if (!initialDataReceived) {
            ipcRenderer.send('request-conflict-data');
        }
    }, 500);
});

/**
 * Muestra un mensaje cuando no hay conflictos para mostrar
 */
function showNoConflictsMessage() {
    const conflictsContainer = document.getElementById('conflicts-list');
    if (conflictsContainer) {
        conflictsContainer.innerHTML = `
            <div class="conflict-group" style="text-align: center; padding: 40px;">
                <h3>No se encontraron conflictos</h3>
                <p>No hay conflictos para resolver o los datos aún no se han cargado. Intenta cerrar y volver a abrir esta ventana.</p>
            </div>
        `;
    }
}

/**
 * Inicializa los controles de la ventana
 */
function initWindowControls() {
    document.getElementById('minimize-btn').addEventListener('click', () => {
        remote.getCurrentWindow().minimize();
    });

    document.getElementById('maximize-btn').addEventListener('click', () => {
        const currentWindow = remote.getCurrentWindow();
        if (currentWindow.isMaximized()) {
            currentWindow.unmaximize();
        } else {
            currentWindow.maximize();
        }
    });

    document.getElementById('close-btn').addEventListener('click', () => {
        remote.getCurrentWindow().close();
    });
}

/**
 * Inicializa los botones de acción
 */
function initActionButtons() {
    document.getElementById('cancel-btn').addEventListener('click', () => {
        ipcRenderer.send('conflict-resolution-cancelled');
    });

    document.getElementById('apply-order-btn').addEventListener('click', () => {
        // Recopilar el orden final de los mods
        const allModItems = document.querySelectorAll('.mod-item');
        const finalOrder = Array.from(allModItems).map(item => item.dataset.modId);
        
        // Eliminar duplicados y mantener el orden
        const uniqueOrder = [...new Set(finalOrder)];
        
        ipcRenderer.send('conflict-resolution-completed', { manualModOrder: uniqueOrder });
    });
}

/**
 * Renderiza los conflictos en la UI
 */
function renderConflicts() {
    const conflictsContainer = document.getElementById('conflicts-list');
    if (!conflictsContainer) {
        console.error('No se encontró el contenedor de conflictos');
        return;
    }
    
    conflictsContainer.innerHTML = '';
    
    // Verificar si hay conflictos para mostrar
    if (!conflicts || conflicts.length === 0) {
        showNoConflictsMessage();
        return;
    }
    
    // Crear un mapa para agrupar conflictos por mods involucrados
    const conflictsByMods = new Map();
    
    // Agrupar conflictos por los mods involucrados
    groupConflictsByMods(conflictsByMods);
    
    // Verificar que se hayan agrupado los conflictos
    if (conflictsByMods.size === 0) {
        showNoConflictsMessage();
        return;
    }
    
    // Mostrar cada grupo de conflictos
    let conflictGroupIndex = 0;
    for (const [key, group] of conflictsByMods.entries()) {
        conflictGroupIndex++;
        
        const groupDiv = createConflictGroupElement(group, conflictGroupIndex);
        conflictsContainer.appendChild(groupDiv);
    }
}

/**
 * Agrupa los conflictos por mods involucrados
 * @param {Map} conflictsByMods - Mapa para almacenar los grupos
 */
function groupConflictsByMods(conflictsByMods) {
    conflicts.forEach(conflict => {
        // Verificar que el conflicto tenga datos válidos
        if (!conflict || !conflict.mods || conflict.mods.length === 0) {
            console.error('Conflicto inválido:', conflict);
            return;
        }
        
        // Crear una clave única para este conjunto de mods en conflicto
        const modsKey = conflict.mods.map(m => m.modId).sort().join('|');
        
        if (!conflictsByMods.has(modsKey)) {
            conflictsByMods.set(modsKey, {
                mods: conflict.mods.map(m => m.modId),
                items: []
            });
        }
        
        // Agregar este item al grupo de conflictos
        conflictsByMods.get(modsKey).items.push({
            name: conflict.itemName,
            parentPreset: conflict.mods[0].parentPreset,
            values: conflict.mods.map(m => ({
                modId: m.modId,
                count: m.count,
                amount: m.amount,
                value: m.value,
                parentPreset: m.parentPreset
            }))
        });
    });
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
    
    // Añadir la vista previa de items
    const previewDiv = createItemsPreview(group.items);
    groupDiv.appendChild(previewDiv);
    
    // Lista de mods para ordenar
    const modListUl = createModsOrderList(group.mods, groupIndex);
    groupDiv.appendChild(modListUl);
    
    // Habilitar drag & drop para este grupo
    enableDragAndDrop(modListUl);
    
    return groupDiv;
}

/**
 * Crea la vista previa de los items en conflicto
 * @param {Array} items - Lista de items en conflicto
 * @returns {HTMLElement} - Elemento DOM con la vista previa
 */
function createItemsPreview(items) {
    const previewDiv = document.createElement('div');
    previewDiv.className = 'conflict-preview';
    
    // Inicialmente mostrar solo los primeros 3 items
    const itemsToShow = 3;
    const hiddenItems = items.slice(itemsToShow);
    const visibleItems = items.slice(0, itemsToShow);
    
    // Variable para rastrear si los items adicionales están visibles
    let additionalItemsVisible = false;
    
    // Crear un contenedor para los ítems visibles con layout horizontal
    const visibleItemsRow = document.createElement('div');
    visibleItemsRow.className = 'items-row';
    
    // Mostrar los primeros items horizontalmente
    visibleItems.forEach((item, index) => {
        const itemDiv = createConflictItemElement(item);
        
        // Agregar el ítem al contenedor horizontal
        visibleItemsRow.appendChild(itemDiv);
        
        // Agregar separador vertical después de cada item excepto el último
        if (index < visibleItems.length - 1) {
            const separator = document.createElement('div');
            separator.className = 'item-separator-vertical';
            visibleItemsRow.appendChild(separator);
        }
    });
    
    previewDiv.appendChild(visibleItemsRow);
    
    // Crear un contenedor para los items adicionales (inicialmente oculto)
    let hiddenItemsRows = [];
    
    // Procesamos los items ocultos en filas de 3 para mantener consistencia visual
    for (let i = 0; i < hiddenItems.length; i += itemsToShow) {
        const rowItems = hiddenItems.slice(i, i + itemsToShow);
        const hiddenItemsRow = document.createElement('div');
        hiddenItemsRow.className = 'items-row';
        hiddenItemsRow.style.display = 'none'; // Inicialmente oculto
        
        rowItems.forEach((item, index) => {
            const itemDiv = createConflictItemElement(item);
            
            hiddenItemsRow.appendChild(itemDiv);
            
            // Agregar separador vertical después de cada item excepto el último
            if (index < rowItems.length - 1) {
                const separator = document.createElement('div');
                separator.className = 'item-separator-vertical';
                hiddenItemsRow.appendChild(separator);
            }
        });
        
        previewDiv.appendChild(hiddenItemsRow);
        hiddenItemsRows.push(hiddenItemsRow);
    }
    
    // Agregar botón "mostrar más" si hay items adicionales
    if (hiddenItems.length > 0) {
        const showMoreBtn = document.createElement('button');
        showMoreBtn.className = 'show-more-btn';
        showMoreBtn.textContent = `Mostrar ${hiddenItems.length} items más...`;
        showMoreBtn.addEventListener('click', function() {
            additionalItemsVisible = !additionalItemsVisible;
            
            // Mostrar u ocultar todas las filas de items adicionales
            hiddenItemsRows.forEach(row => {
                row.style.display = additionalItemsVisible ? 'flex' : 'none';
            });
            
            this.textContent = additionalItemsVisible 
                ? 'Ocultar items adicionales' 
                : `Mostrar ${hiddenItems.length} items más...`;
        });
        previewDiv.appendChild(showMoreBtn);
    }
    
    return previewDiv;
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
        const modA = modDetails.find(m => m.id === a);
        const modB = modDetails.find(m => m.id === b);
        
        // Si ambos tienen detalles, ordenar por prioridad (si existe)
        if (modA && modB) {
            // Mayor prioridad primero (números mayores)
            return (modB.priority || -1) - (modA.priority || -1);
        }
        
        // Si solo uno tiene detalles, ponerlo primero
        if (modA) return -1;
        if (modB) return 1;
        
        // Orden alfabético si no hay criterio mejor
        return a.localeCompare(b);
    });
    
    // Crear los elementos de la lista para cada mod
    modsToDisplay.forEach((modId, index) => {
        const modDetailInfo = getModDetails(modId);
        const modItemLi = createModListItem(modId, modDetailInfo, index === 0, moveItem);
        modListUl.appendChild(modItemLi);
    });
    
    return modListUl;
}

/**
 * Mueve un elemento de la lista hacia arriba o hacia abajo
 * @param {HTMLElement} item - Elemento a mover
 * @param {string} direction - Dirección ('up' o 'down')
 */
function moveItem(item, direction) {
    const list = item.parentNode;
    if (direction === 'up' && item.previousElementSibling) {
        list.insertBefore(item, item.previousElementSibling);
    } else if (direction === 'down' && item.nextElementSibling) {
        list.insertBefore(item.nextElementSibling, item);
    }
    updatePriorityIndicators(list);
}

/**
 * Habilita el arrastrar y soltar para una lista
 * @param {HTMLElement} listElement - Lista de elementos arrastables
 */
function enableDragAndDrop(listElement) {
    let draggedItem = null;
    
    // Eventos para los elementos de la lista
    const items = listElement.querySelectorAll('.mod-item');
    items.forEach(item => {
        // Cuando comienza el arrastre
        item.addEventListener('dragstart', function(e) {
            draggedItem = this;
            setTimeout(() => this.classList.add('dragging'), 0);
        });
        
        // Cuando termina el arrastre
        item.addEventListener('dragend', function() {
            this.classList.remove('dragging');
            draggedItem = null;
            updatePriorityIndicators(listElement);
        });
        
        // Cuando un elemento arrastrado entra en otro elemento
        item.addEventListener('dragover', function(e) {
            e.preventDefault();
        });
        
        // Cuando se suelta un elemento sobre otro
        item.addEventListener('drop', function(e) {
            e.preventDefault();
            if (draggedItem && this !== draggedItem) {
                // Determinar si insertar antes o después según la posición
                const rect = this.getBoundingClientRect();
                const midpoint = (rect.top + rect.bottom) / 2;
                
                if (e.clientY < midpoint) {
                    listElement.insertBefore(draggedItem, this);
                } else {
                    listElement.insertBefore(draggedItem, this.nextSibling);
                }
            }
        });
    });
    
    // Eventos para el contenedor de la lista
    listElement.addEventListener('dragover', function(e) {
        e.preventDefault();
        const afterElement = getDragAfterElement(this, e.clientY);
        if (draggedItem) {
            if (afterElement) {
                this.insertBefore(draggedItem, afterElement);
            } else {
                this.appendChild(draggedItem);
            }
        }
    });
}

/**
 * Obtiene los detalles de un mod por su ID
 * @param {string} modId - ID del mod
 * @returns {Object|null} - Detalles del mod o null si no se encuentra
 */
function getModDetails(modId) {
    return modDetails.find(mod => mod.id === modId);
}