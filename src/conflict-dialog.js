const { ipcRenderer } = require('electron');
const remote = require('@electron/remote');

let conflicts = [];
let modDetails = [];
let selectedOrder = [];

document.addEventListener('DOMContentLoaded', () => {
    // Configurar los controles de la ventana
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

    // Botones de acción
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

    // Recibir datos de conflictos desde el proceso principal
    ipcRenderer.on('conflict-data', (event, data) => {
        conflicts = data.conflicts;
        modDetails = data.modDetails;
        
        // Generar la interfaz de usuario para los conflictos
        renderConflicts();
    });
});

function renderConflicts() {
    const conflictsContainer = document.getElementById('conflicts-list');
    conflictsContainer.innerHTML = '';
    
    // Crear un mapa para agrupar conflictos por mods involucrados
    const conflictsByMods = new Map();
    
    conflicts.forEach(conflict => {
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
            values: conflict.mods.map(m => ({
                modId: m.modId,
                count: m.count,
                amount: m.amount,
                value: m.value
            }))
        });
    });
    
    // Mostrar cada grupo de conflictos
    let conflictGroupIndex = 0;
    for (const [key, group] of conflictsByMods.entries()) {
        conflictGroupIndex++;
        
        const groupDiv = document.createElement('div');
        groupDiv.className = 'conflict-group';
        
        // Título del grupo
        const headerDiv = document.createElement('div');
        headerDiv.className = 'conflict-header';
        headerDiv.textContent = `Grupo de Conflicto ${conflictGroupIndex}: ${group.mods.length} Mods`;
        groupDiv.appendChild(headerDiv);
        
        // Descripción
        const descDiv = document.createElement('div');
        descDiv.className = 'conflict-description';
        descDiv.textContent = `Estos mods modifican ${group.items.length} items con valores diferentes. Arrastra para establecer el orden de prioridad.`;
        groupDiv.appendChild(descDiv);
        
        // Mostrar ejemplos de items en conflicto
        const previewDiv = document.createElement('div');
        previewDiv.className = 'conflict-preview';
        
        // Solo mostrar hasta 3 items como ejemplo
        const previewItems = group.items.slice(0, 3);
        
        previewItems.forEach(item => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'conflict-item';
            
            const itemNameDiv = document.createElement('div');
            itemNameDiv.className = 'conflict-item-name';
            itemNameDiv.textContent = item.name;
            itemDiv.appendChild(itemNameDiv);
            
            // Mostrar un ejemplo de valores en conflicto (primer mod vs segundo mod)
            if (item.values.length >= 2) {
                const mod1 = item.values[0];
                const mod2 = item.values[1];
                
                let valueText = '';
                
                if (mod1.count !== undefined && mod2.count !== undefined && mod1.count !== mod2.count) {
                    valueText += `Cantidad (Count): ${mod1.count} vs ${mod2.count} `;
                }
                
                if (mod1.amount !== undefined && mod2.amount !== undefined && mod1.amount !== mod2.amount) {
                    valueText += `Cantidad (Amount): ${mod1.amount} vs ${mod2.amount} `;
                }
                
                if (mod1.value !== undefined && mod2.value !== undefined && mod1.value !== mod2.value) {
                    valueText += `Valor: ${mod1.value} vs ${mod2.value}`;
                }
                
                if (valueText) {
                    const valuesDiv = document.createElement('div');
                    valuesDiv.className = 'conflict-item-values';
                    valuesDiv.textContent = valueText;
                    itemDiv.appendChild(valuesDiv);
                }
            }
            
            previewDiv.appendChild(itemDiv);
        });
        
        // Agregar texto de "y más" si hay más items
        if (group.items.length > 3) {
            const moreDiv = document.createElement('div');
            moreDiv.textContent = `Y ${group.items.length - 3} items más...`;
            previewDiv.appendChild(moreDiv);
        }
        
        groupDiv.appendChild(previewDiv);
        
        // Lista de mods para ordenar
        const modListUl = document.createElement('ul');
        modListUl.className = 'mod-priority-list';
        modListUl.id = `mod-list-${conflictGroupIndex}`;
        
        // Ordenar los mods: los que están en modDetails primero, luego el resto
        const modsToDisplay = [...group.mods].sort((a, b) => {
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
            const modDetails = getModDetails(modId);
            const modItemLi = createModListItem(modId, modDetails, index === 0);
            modListUl.appendChild(modItemLi);
        });
        
        groupDiv.appendChild(modListUl);
        
        // Habilitar drag & drop para este grupo
        enableDragAndDrop(modListUl);
        
        conflictsContainer.appendChild(groupDiv);
    }
}

function createModListItem(modId, modDetails, isFirst) {
    const li = document.createElement('li');
    li.className = 'mod-item';
    li.dataset.modId = modId;
    li.draggable = true;
    
    const modInfoDiv = document.createElement('div');
    modInfoDiv.className = 'mod-info';
    
    const modNameDiv = document.createElement('div');
    modNameDiv.className = 'mod-name';
    modNameDiv.textContent = modId;
    modInfoDiv.appendChild(modNameDiv);
    
    if (modDetails) {
        const modDetailsDiv = document.createElement('div');
        modDetailsDiv.className = 'mod-details';
        
        // Mostrar prioridad si existe
        if (modDetails.priority !== undefined && modDetails.priority !== -1) {
            modDetailsDiv.textContent = `Prioridad original: ${modDetails.priority}`;
        } else {
            modDetailsDiv.textContent = 'Sin prioridad definida';
        }
        
        modInfoDiv.appendChild(modDetailsDiv);
    }
    
    li.appendChild(modInfoDiv);
    
    // Controles de movimiento
    const controlsDiv = document.createElement('div');
    controlsDiv.className = 'mod-controls';
    
    const moveUpBtn = document.createElement('button');
    moveUpBtn.className = 'move-up';
    moveUpBtn.innerHTML = '&#9650;';
    moveUpBtn.title = 'Mover hacia arriba (aumentar prioridad)';
    moveUpBtn.addEventListener('click', () => moveItem(li, 'up'));
    controlsDiv.appendChild(moveUpBtn);
    
    const moveDownBtn = document.createElement('button');
    moveDownBtn.className = 'move-down';
    moveDownBtn.innerHTML = '&#9660;';
    moveDownBtn.title = 'Mover hacia abajo (disminuir prioridad)';
    moveDownBtn.addEventListener('click', () => moveItem(li, 'down'));
    controlsDiv.appendChild(moveDownBtn);
    
    li.appendChild(controlsDiv);
    
    // Añadir un indicador visual si es el primer mod (mayor prioridad)
    if (isFirst) {
        const priorityDiv = document.createElement('div');
        priorityDiv.className = 'priority-badge';
        priorityDiv.textContent = '1º';
        priorityDiv.style.backgroundColor = 'var(--accent-color)';
        priorityDiv.style.color = 'white';
        priorityDiv.style.padding = '2px 6px';
        priorityDiv.style.borderRadius = '4px';
        priorityDiv.style.fontSize = '12px';
        priorityDiv.style.marginRight = '8px';
        controlsDiv.prepend(priorityDiv);
    }
    
    return li;
}

function moveItem(item, direction) {
    const list = item.parentNode;
    if (direction === 'up' && item.previousElementSibling) {
        list.insertBefore(item, item.previousElementSibling);
    } else if (direction === 'down' && item.nextElementSibling) {
        list.insertBefore(item.nextElementSibling, item);
    }
    updatePriorityIndicators(list);
}

function updatePriorityIndicators(list) {
    // Eliminar todos los indicadores de prioridad
    list.querySelectorAll('.priority-badge').forEach(badge => badge.remove());
    
    // Añadir indicador al primer elemento
    const firstItem = list.querySelector('.mod-item');
    if (firstItem) {
        const controlsDiv = firstItem.querySelector('.mod-controls');
        
        const priorityDiv = document.createElement('div');
        priorityDiv.className = 'priority-badge';
        priorityDiv.textContent = '1º';
        priorityDiv.style.backgroundColor = 'var(--accent-color)';
        priorityDiv.style.color = 'white';
        priorityDiv.style.padding = '2px 6px';
        priorityDiv.style.borderRadius = '4px';
        priorityDiv.style.fontSize = '12px';
        priorityDiv.style.marginRight = '8px';
        
        controlsDiv.prepend(priorityDiv);
    }
}

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

function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.mod-item:not(.dragging)')];
    
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function getModDetails(modId) {
    return modDetails.find(mod => mod.id === modId);
}