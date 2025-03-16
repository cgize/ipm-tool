// conflict-dialog.js
const { ipcRenderer } = require('electron');
const remote = require('@electron/remote');
const { 
    createConflictItemElement, 
    createCompactConflictItem,
    createGroupedConflictItems,
    createConflictGroupElement,
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

    // Pre-ordenar los items dentro de cada grupo por valores más altos primero
    for (const [key, group] of conflictsByMods.entries()) {
        if (group.items && group.items.length > 0) {
            group.items.sort((a, b) => {
                // Intentar ordenar por el valor más alto de Count, Amount o Value
                const aHighestValue = getHighestValue(a);
                const bHighestValue = getHighestValue(b);
                return bHighestValue - aHighestValue;
            });
        }
    }
}

/**
 * Obtiene el valor más alto (count, amount, value) de un item en conflicto
 * @param {Object} item - El item en conflicto
 * @returns {number} - El valor más alto encontrado
 */
function getHighestValue(item) {
    if (!item || !item.values || item.values.length === 0) return 0;
    
    let highestCount = 0;
    let highestAmount = 0;
    let highestValue = 0;
    
    item.values.forEach(value => {
        if (value.count !== undefined) {
            highestCount = Math.max(highestCount, parseFloat(value.count) || 0);
        }
        if (value.amount !== undefined) {
            highestAmount = Math.max(highestAmount, parseFloat(value.amount) || 0);
        }
        if (value.value !== undefined) {
            highestValue = Math.max(highestValue, parseFloat(value.value) || 0);
        }
    });
    
    // Priorizar el valor más alto encontrado
    return Math.max(highestCount, highestAmount, highestValue);
}