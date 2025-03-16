// conflict-dialog.js
const { ipcRenderer } = require('electron');
const remote = require('@electron/remote');
const { 
    createModListItem, 
    moveItem, 
    updatePriorityIndicators, 
    getDragAfterElement, 
    enableDragAndDrop 
} = require('./conflict-utils');

let conflicts = [];
let modDetails = [];
let selectedMethod = '';
let initialDataReceived = false;

// Habilitar drag para la ventana completa a través del elemento instructions
function setupWindowDrag() {
    // Expandir la región de arrastre para cubrir el encabezado
    const dragRegion = document.getElementById('drag-region');
    if (dragRegion) {
        dragRegion.style.height = '30px'; // Hacer la zona de arrastre más alta
    }

    // Hacer que el título sea parte de la región de arrastre
    const instructionsHeader = document.querySelector('.instructions h3');
    if (instructionsHeader) {
        instructionsHeader.style.webkitAppRegion = 'drag';
        instructionsHeader.style.cursor = 'move';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    setupWindowDrag();
    initResolutionOptions();
    initActionButtons();
    
    // Recibir datos de conflictos desde el proceso principal
    ipcRenderer.on('conflict-data', (event, data) => {
        conflicts = data.conflicts || [];
        modDetails = data.modDetails || [];
        initialDataReceived = true;
        
        // Asegurar que los datos sean válidos antes de renderizar
        if (conflicts.length > 0 || modDetails.length > 0) {
            populateModList();
        } else {
            // Si no hay conflictos, mostrar un mensaje
            showNoConflictsMessage();
        }
    });
    
    // Solicitar los datos
    setTimeout(() => {
        if (!initialDataReceived) {
            ipcRenderer.send('request-conflict-data');
        }
    }, 500);
});

/**
 * Inicializa las opciones de resolución
 */
function initResolutionOptions() {
    const resolutionOptions = document.querySelectorAll('.resolution-option');
    const manualResolutionPanel = document.getElementById('manual-resolution-panel');
    
    // Añadir listeners a todas las opciones
    resolutionOptions.forEach(option => {
        option.addEventListener('click', function() {
            // Quitar la clase seleccionada de todas las opciones
            resolutionOptions.forEach(opt => opt.classList.remove('selected'));
            
            // Añadir la clase seleccionada a la opción clickeada
            this.classList.add('selected');
            
            // Marcar el radio button
            const radioBtn = this.querySelector('input[type="radio"]');
            radioBtn.checked = true;
            
            // Actualizar el método seleccionado
            selectedMethod = radioBtn.value;
            
            // Mostrar u ocultar el panel de resolución manual
            if (selectedMethod === 'manual') {
                manualResolutionPanel.style.display = 'block';
            } else {
                manualResolutionPanel.style.display = 'none';
            }
        });
        
        // También añadir listener al radio button dentro de cada opción
        const radioBtn = option.querySelector('input[type="radio"]');
        radioBtn.addEventListener('change', function() {
            if (this.checked) {
                // Quitar la clase seleccionada de todas las opciones
                resolutionOptions.forEach(opt => opt.classList.remove('selected'));
                
                // Añadir la clase seleccionada al contenedor del radio button
                this.closest('.resolution-option').classList.add('selected');
                
                // Actualizar el método seleccionado
                selectedMethod = this.value;
                
                // Mostrar u ocultar el panel de resolución manual
                if (selectedMethod === 'manual') {
                    manualResolutionPanel.style.display = 'block';
                } else {
                    manualResolutionPanel.style.display = 'none';
                }
            }
        });
    });
    
    // Seleccionar la primera opción por defecto
    document.getElementById('highest-value-radio').click();
}

/**
 * Inicializa los botones de acción
 */
function initActionButtons() {
    document.getElementById('cancel-btn').addEventListener('click', () => {
        ipcRenderer.send('conflict-resolution-cancelled');
    });

    document.getElementById('apply-resolution-btn').addEventListener('click', () => {
        if (selectedMethod === 'manual') {
            // Recopilar el orden final de los mods
            const allModItems = document.querySelectorAll('.mod-item');
            const manualModOrder = Array.from(allModItems).map(item => item.dataset.modId);
            
            // Eliminar duplicados y mantener el orden
            const uniqueOrder = [...new Set(manualModOrder)];
            
            ipcRenderer.send('conflict-resolution-completed', { 
                method: 'manual',
                manualModOrder: uniqueOrder 
            });
        } else {
            // Enviar el método seleccionado
            ipcRenderer.send('conflict-resolution-completed', { 
                method: selectedMethod
            });
        }
    });
}

/**
 * Muestra un mensaje cuando no hay conflictos para mostrar
 */
function showNoConflictsMessage() {
    const conflictsContainer = document.getElementById('conflict-container');
    const noConflictsMsg = document.createElement('div');
    noConflictsMsg.className = 'no-conflicts-message';
    noConflictsMsg.innerHTML = `
        <h3>No conflicts detected</h3>
        <p>No mod conflicts were found or the data hasn't loaded yet. Try closing and reopening this window.</p>
    `;
    
    // Limpiar contenido existente
    conflictsContainer.innerHTML = '';
    conflictsContainer.appendChild(noConflictsMsg);
}

/**
 * Verifica si un mod está involucrado en algún conflicto de InventoryPreset
 * @param {string} modId - ID del mod a verificar
 * @returns {boolean} - True si el mod está involucrado en algún conflicto
 */
function isModInvolvedInInventoryPresetConflict(modId) {
    if (!conflicts || conflicts.length === 0) return false;
    
    // Verificar si el modId está presente en algún conflicto
    return conflicts.some(conflict => {
        if (!conflict.mods || !Array.isArray(conflict.mods)) return false;
        return conflict.mods.some(mod => mod.modId === modId);
    });
}

/**
 * Verifica si un mod contiene archivos de InventoryPreset
 * @param {string} modId - ID del mod a verificar
 * @returns {boolean} - True si el mod contiene archivos de InventoryPreset
 */
function modHasInventoryPresetFiles(modId) {
    // Buscar en modDetails si hay alguna entrada que contenga InventoryPreset
    const mod = modDetails.find(m => m.id === modId);
    if (!mod) return false;
    
    // Revisar presetItems - si tiene elementos es porque es un mod de InventoryPreset
    return mod.presetItems && mod.presetItems.size > 0;
}

/**
 * Llena la lista de mods para la resolución manual
 */
function populateModList() {
    const modList = document.getElementById('mod-priority-list');
    if (!modList) return;
    
    modList.innerHTML = '';
    
    // Crear una lista única de todos los mods relevantes
    let relevantMods = new Set();
    
    // Añadir mods de los conflictos (que son específicamente de InventoryPreset)
    if (conflicts && conflicts.length > 0) {
        conflicts.forEach(conflict => {
            if (conflict.mods && Array.isArray(conflict.mods)) {
                conflict.mods.forEach(mod => {
                    if (mod.modId) relevantMods.add(mod.modId);
                });
            }
        });
    }
    
    // Añadir mods de modDetails que contengan archivos de InventoryPreset
    if (modDetails && modDetails.length > 0) {
        modDetails.forEach(mod => {
            if (mod.id && modHasInventoryPresetFiles(mod.id)) {
                relevantMods.add(mod.id);
            }
        });
    }
    
    // Convertir el Set a Array para ordenar
    let modsArray = Array.from(relevantMods);
    
    // Si no hay mods relevantes, mostrar mensaje
    if (modsArray.length === 0) {
        const emptyMessage = document.createElement('p');
        emptyMessage.className = 'empty-mods-message';
        emptyMessage.textContent = 'No mods with InventoryPreset files were found.';
        modList.parentNode.appendChild(emptyMessage);
        return;
    }
    
    // Ordenar los mods: primero por prioridad existente, luego alfabéticamente
    modsArray.sort((a, b) => {
        const modA = modDetails.find(m => m.id === a);
        const modB = modDetails.find(m => m.id === b);
        
        // Si ambos tienen prioridad, ordenar por prioridad (mayor primero)
        if (modA && modB && modA.priority !== undefined && modB.priority !== undefined) {
            return modB.priority - modA.priority;
        }
        
        // Si solo uno tiene prioridad, ponerlo primero
        if (modA && modA.priority !== undefined && modA.priority !== -1) return -1;
        if (modB && modB.priority !== undefined && modB.priority !== -1) return 1;
        
        // Orden alfabético si no hay criterio mejor
        return a.localeCompare(b);
    });
    
    // Crear los elementos de la lista para cada mod
    modsArray.forEach((modId, index) => {
        const modDetailInfo = modDetails.find(m => m.id === modId);
        const li = createModListItem(modId, modDetailInfo, index === 0);
        modList.appendChild(li);
    });
    
    // Habilitar drag & drop para la lista
    enableDragAndDrop(modList);
}