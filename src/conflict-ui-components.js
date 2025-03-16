// conflict-ui-components.js
// Funciones para crear componentes de UI para el diálogo de conflictos

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
    
    // Mostrar los valores en conflicto
    if (item.values && item.values.length >= 2) {
        const valuesContainer = document.createElement('div');
        valuesContainer.className = 'conflict-item-values';
        
        // Crear tabla para los valores en conflicto
        const table = document.createElement('table');
        table.className = 'conflict-values-table';
        
        // Crear encabezado
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        
        // Columna de tipo de valor
        const thType = document.createElement('th');
        thType.textContent = "Tipo";
        headerRow.appendChild(thType);
        
        // Columnas para cada mod
        item.values.forEach(value => {
            const thMod = document.createElement('th');
            thMod.textContent = value.modId || "Desconocido";
            headerRow.appendChild(thMod);
        });
        
        thead.appendChild(headerRow);
        table.appendChild(thead);
        
        // Crear cuerpo de la tabla
        const tbody = document.createElement('tbody');
        
        // Fila para Count si está presente
        if (item.values.some(v => v.count !== undefined)) {
            const countRow = document.createElement('tr');
            
            const countTypeCell = document.createElement('td');
            countTypeCell.textContent = "Count";
            countRow.appendChild(countTypeCell);
            
            item.values.forEach(value => {
                const countCell = document.createElement('td');
                countCell.textContent = value.count !== undefined ? value.count : "-";
                countRow.appendChild(countCell);
            });
            
            tbody.appendChild(countRow);
        }
        
        // Fila para Amount si está presente
        if (item.values.some(v => v.amount !== undefined)) {
            const amountRow = document.createElement('tr');
            
            const amountTypeCell = document.createElement('td');
            amountTypeCell.textContent = "Amount";
            amountRow.appendChild(amountTypeCell);
            
            item.values.forEach(value => {
                const amountCell = document.createElement('td');
                amountCell.textContent = value.amount !== undefined ? value.amount : "-";
                amountRow.appendChild(amountCell);
            });
            
            tbody.appendChild(amountRow);
        }
        
        // Fila para Value si está presente
        if (item.values.some(v => v.value !== undefined)) {
            const valueRow = document.createElement('tr');
            
            const valueTypeCell = document.createElement('td');
            valueTypeCell.textContent = "Value";
            valueRow.appendChild(valueTypeCell);
            
            item.values.forEach(value => {
                const valueCell = document.createElement('td');
                valueCell.textContent = value.value !== undefined ? value.value : "-";
                valueRow.appendChild(valueCell);
            });
            
            tbody.appendChild(valueRow);
        }
        
        table.appendChild(tbody);
        valuesContainer.appendChild(table);
        itemDiv.appendChild(valuesContainer);
    }
    
    return itemDiv;
}

/**
 * Crea un elemento de lista para representar un mod
 * @param {string} modId - ID del mod
 * @param {Object} modDetails - Detalles del mod
 * @param {boolean} isFirst - Indica si es el primer mod (mayor prioridad)
 * @param {Function} moveItemCallback - Función para manejar el movimiento de items
 * @returns {HTMLElement} - Elemento DOM que representa el mod
 */
function createModListItem(modId, modDetails, isFirst, moveItemCallback) {
    const li = document.createElement('li');
    li.className = 'mod-item';
    li.dataset.modId = modId || '';
    li.draggable = true;
    
    const modInfoDiv = document.createElement('div');
    modInfoDiv.className = 'mod-info';
    
    const modNameDiv = document.createElement('div');
    modNameDiv.className = 'mod-name';
    modNameDiv.textContent = modId || 'Mod desconocido';
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
    moveUpBtn.addEventListener('click', () => {
        if (moveItemCallback) moveItemCallback(li, 'up');
    });
    controlsDiv.appendChild(moveUpBtn);
    
    const moveDownBtn = document.createElement('button');
    moveDownBtn.className = 'move-down';
    moveDownBtn.innerHTML = '&#9660;';
    moveDownBtn.title = 'Mover hacia abajo (disminuir prioridad)';
    moveDownBtn.addEventListener('click', () => {
        if (moveItemCallback) moveItemCallback(li, 'down');
    });
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

/**
 * Actualiza los indicadores de prioridad en la lista
 * @param {HTMLElement} list - Lista de elementos
 */
function updatePriorityIndicators(list) {
    if (!list) return;
    
    // Eliminar todos los indicadores de prioridad
    list.querySelectorAll('.priority-badge').forEach(badge => badge.remove());
    
    // Añadir indicador al primer elemento
    const firstItem = list.querySelector('.mod-item');
    if (firstItem) {
        const controlsDiv = firstItem.querySelector('.mod-controls');
        if (controlsDiv) {
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
}

/**
 * Determina después de qué elemento se debe soltar un elemento arrastrado
 * @param {HTMLElement} container - Contenedor de elementos
 * @param {number} y - Posición vertical del puntero
 * @returns {HTMLElement|null} - Elemento después del cual insertar
 */
function getDragAfterElement(container, y) {
    if (!container) return null;
    
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

// Exportar todas las funciones del módulo
module.exports = {
    createConflictItemElement,
    createModListItem,
    updatePriorityIndicators,
    getDragAfterElement
};