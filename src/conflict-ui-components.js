// conflict-ui-components.js
// Funciones para crear componentes de UI para el diálogo de conflictos

const { 
    createModListItem, 
    updatePriorityIndicators, 
    enableDragAndDrop 
} = require('./conflict-utils');

// Variable global para almacenar los detalles de los mods
// Esta variable será alimentada desde conflict-dialog.js
let modDetails = [];

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

/**
 * Mueve un elemento de la lista hacia arriba o hacia abajo
 * Esta función es una copia de moveItem en conflict-utils.js pero
 * mantiene la referencia local para evitar dependencias circulares
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

// Exportar solo las funciones esenciales del módulo
module.exports = {
    setModDetails,
    getModDetails,
    moveItem
};