// logger.js
// Sistema de logging para la aplicación IPM Tool

const config = require('./config');

/**
 * Niveles de log
 */
const LOG_LEVELS = {
    DEBUG: 'DEBUG',
    INFO: 'INFO',
    WARN: 'WARN',
    ERROR: 'ERROR'
};

/**
 * Secciones para el reporte de log
 */
const LOG_SECTIONS = {
    HEADER: {
        TITLE: "IPM TOOL LOG",
        SEPARATOR: "============="
    },
    MANUAL_ORDER: {
        TITLE: "MANUAL MOD ORDER",
        SEPARATOR: "----------------"
    },
    CONFLICTS: {
        TITLE: "CONFLICTS DETECTED",
        SEPARATOR: "------------------"
    },
    PAK_FILES: {
        TITLE: "PAK FILES PROCESSED",
        SEPARATOR: "------------------"
    },
    XML_FILES: {
        TITLE: "XML FILES PROCESSED",
        SEPARATOR: "------------------"
    },
    MODS_COMBINED: {
        TITLE: "MODS COMBINED",
        SEPARATOR: "-------------"
    },
    PROCESS_LOG: {
        TITLE: "PROCESS LOG",
        SEPARATOR: "-----------"
    }
};

/**
 * Clase para gestionar logs de la aplicación
 */
class Logger {
    constructor() {
        this.logs = [];
        this.pakFiles = [];
        this.xmlFiles = [];
        this.combinedMods = new Map();
        this.conflicts = [];
        this.startTime = new Date();
        this.usedManualOrder = false;
        this.manualModOrder = [];
    }

    /**
     * Registra un mensaje de depuración
     * @param {string} message - Mensaje a registrar
     */
    debug(message) {
        this._log(LOG_LEVELS.DEBUG, message);
    }

    /**
     * Registra un mensaje informativo
     * @param {string} message - Mensaje a registrar
     */
    info(message) {
        this._log(LOG_LEVELS.INFO, message);
    }

    /**
     * Registra un mensaje de advertencia
     * @param {string} message - Mensaje a registrar
     */
    warn(message) {
        this._log(LOG_LEVELS.WARN, message);
    }

    /**
     * Registra un mensaje de error
     * @param {string} message - Mensaje a registrar
     */
    error(message) {
        this._log(LOG_LEVELS.ERROR, message);
    }

    /**
     * Método interno para registrar mensajes con un nivel específico
     * @param {string} level - Nivel del log
     * @param {string} message - Mensaje a registrar
     * @private
     */
    _log(level, message) {
        const timestamp = new Date().toISOString();
        this.logs.push(`[${level}] [${timestamp}] ${message}`);
    }

    /**
     * Registra información sobre el orden manual de mods
     * @param {string[]} manualOrder - Lista de IDs de mods en orden de prioridad
     */
    setManualOrder(manualOrder) {
        this.usedManualOrder = true;
        this.manualModOrder = manualOrder;
    }

    /**
     * Añade información sobre un conflicto detectado
     * @param {Object} conflict - Información sobre el conflicto
     */
    addConflict(conflict) {
        this.conflicts.push(conflict);
    }

    /**
     * Genera el contenido completo del log
     * @returns {string} - Contenido del log formateado
     */
    getLogContent() {
        const endTime = new Date();
        const duration = (endTime - this.startTime) / 1000; // seconds
        
        let content = `${LOG_SECTIONS.HEADER.TITLE}\n`;
        content += `${LOG_SECTIONS.HEADER.SEPARATOR}\n\n`;
        content += `Process started: ${this.startTime.toISOString()}\n`;
        content += `Process ended: ${endTime.toISOString()}\n`;
        content += `Duration: ${duration.toFixed(2)} seconds\n\n`;
        
        // Añadir información sobre el orden manual si se utilizó
        if (this.usedManualOrder) {
            content += `${LOG_SECTIONS.MANUAL_ORDER.TITLE}\n`;
            content += `${LOG_SECTIONS.MANUAL_ORDER.SEPARATOR}\n`;
            if (this.manualModOrder.length > 0) {
                content += "The following manual order was used (highest priority first):\n";
                content += this.manualModOrder.map((modId, index) => `${index + 1}. ${modId}`).join('\n');
            } else {
                content += "Manual ordering was enabled but no order was specified.";
            }
            content += "\n\n";
        }
        
        // Añadir información sobre conflictos detectados
        if (this.conflicts.length > 0) {
            content += `${LOG_SECTIONS.CONFLICTS.TITLE}\n`;
            content += `${LOG_SECTIONS.CONFLICTS.SEPARATOR}\n`;
            this.conflicts.forEach((conflict, index) => {
                content += `Conflict Group ${index + 1}: Item "${conflict.itemName}"\n`;
                conflict.mods.forEach(mod => {
                    let modValues = [];
                    if (mod.count !== undefined) modValues.push(`Count: ${mod.count}`);
                    if (mod.value !== undefined) modValues.push(`Value: ${mod.value}`);
                    if (mod.amount !== undefined) modValues.push(`Amount: ${mod.amount}`);
                    content += `  - ${mod.modId} (${modValues.join(', ')})\n`;
                });
                content += "\n";
            });
            content += "\n";
        }
        
        content += `${LOG_SECTIONS.PAK_FILES.TITLE}\n`;
        content += `${LOG_SECTIONS.PAK_FILES.SEPARATOR}\n`;
        if (this.pakFiles.length > 0) {
            content += this.pakFiles.map(file => `- ${file}`).join('\n');
        } else {
            content += "No PAK files were processed.";
        }
        content += "\n\n";
        
        content += `${LOG_SECTIONS.XML_FILES.TITLE}\n`;
        content += `${LOG_SECTIONS.XML_FILES.SEPARATOR}\n`;
        if (this.xmlFiles.length > 0) {
            content += this.xmlFiles.map(file => `- ${file}`).join('\n');
        } else {
            content += "No XML files were processed.";
        }
        content += "\n\n";
        
        content += `${LOG_SECTIONS.MODS_COMBINED.TITLE}\n`;
        content += `${LOG_SECTIONS.MODS_COMBINED.SEPARATOR}\n`;
        if (this.combinedMods.size > 0) {
            for (const [modId, data] of this.combinedMods) {
                content += `- ${modId} (Priority: ${data.priority})\n`;
                content += `  Files: ${data.xmls.length}\n`;
            }
        } else {
            content += "No mods were combined.";
        }
        content += "\n\n";
        
        content += `${LOG_SECTIONS.PROCESS_LOG.TITLE}\n`;
        content += `${LOG_SECTIONS.PROCESS_LOG.SEPARATOR}\n`;
        if (this.logs.length > 0) {
            content += this.logs.join('\n');
        } else {
            content += "No log entries.";
        }
        
        return content;
    }
}

module.exports = Logger;