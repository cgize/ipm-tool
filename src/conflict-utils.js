// conflict-utils.js
// Utilidades compartidas para el manejo de conflictos UI

/**
 * Crea un elemento de lista para representar un mod
 * @param {string} modId - ID del mod
 * @param {Object} modDetailInfo - Detalles del mod
 * @param {boolean} isFirst - Indica si es el primer mod (mayor prioridad)
 * @param {Function} moveCallback - Callback opcional para mover elementos
 * @returns {HTMLElement} - Elemento DOM que representa el mod
 */
function createModListItem(modId, modDetailInfo, isFirst, moveCallback) {
    const li = document.createElement('li');
    li.className = 'mod-item';
    li.dataset.modId = modId || '';
    li.draggable = true;
    
    const modInfoDiv = document.createElement('div');
    modInfoDiv.className = 'mod-info';
    
    const modNameDiv = document.createElement('div');
    modNameDiv.className = 'mod-name';
    modNameDiv.textContent = modId || 'Unknown mod';
    modInfoDiv.appendChild(modNameDiv);
    
    if (modDetailInfo) {
        const modDetailsDiv = document.createElement('div');
        modDetailsDiv.className = 'mod-details';
        
        // Mostrar prioridad si existe
        if (modDetailInfo.priority !== undefined && modDetailInfo.priority !== -1) {
            modDetailsDiv.textContent = `Original Priority: ${modDetailInfo.priority}`;
        } else {
            modDetailsDiv.textContent = 'No priority defined';
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
    moveUpBtn.title = 'Move up (increase priority)';
    moveUpBtn.addEventListener('click', () => {
        if (moveCallback) {
            moveCallback(li, 'up');
        } else {
            moveItem(li, 'up');
        }
    });
    controlsDiv.appendChild(moveUpBtn);
    
    const moveDownBtn = document.createElement('button');
    moveDownBtn.className = 'move-down';
    moveDownBtn.innerHTML = '&#9660;';
    moveDownBtn.title = 'Move down (decrease priority)';
    moveDownBtn.addEventListener('click', () => {
        if (moveCallback) {
            moveCallback(li, 'down');
        } else {
            moveItem(li, 'down');
        }
    });
    controlsDiv.appendChild(moveDownBtn);
    
    li.appendChild(controlsDiv);
    
    // Añadir un indicador visual si es el primer mod (mayor prioridad)
    if (isFirst) {
        const priorityDiv = document.createElement('div');
        priorityDiv.className = 'priority-badge';
        priorityDiv.textContent = '1st';
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
            priorityDiv.textContent = '1st';
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

/**
 * Habilita el arrastrar y soltar para una lista
 * @param {HTMLElement} listElement - Lista de elementos arrastables
 */
function enableDragAndDrop(listElement) {
    let draggedItem = null;
    
    // Eventos para los elementos de la lista
    listElement.addEventListener('dragstart', function(e) {
        draggedItem = e.target;
        if (draggedItem.classList.contains('mod-item')) {
            setTimeout(() => draggedItem.classList.add('dragging'), 0);
        }
    });
    
    listElement.addEventListener('dragend', function(e) {
        if (draggedItem) {
            draggedItem.classList.remove('dragging');
            draggedItem = null;
            updatePriorityIndicators(listElement);
        }
    });
    
    listElement.addEventListener('dragover', function(e) {
        e.preventDefault();
        if (!draggedItem || !draggedItem.classList.contains('mod-item')) return;
        
        const afterElement = getDragAfterElement(this, e.clientY);
        if (afterElement) {
            this.insertBefore(draggedItem, afterElement);
        } else {
            this.appendChild(draggedItem);
        }
    });
    
    listElement.addEventListener('dragenter', function(e) {
        e.preventDefault();
    });
}

module.exports = {
    createModListItem,
    moveItem,
    updatePriorityIndicators,
    getDragAfterElement,
    enableDragAndDrop
};