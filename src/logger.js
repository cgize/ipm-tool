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

    info(message) {
        const timestamp = new Date().toISOString();
        this.logs.push(`[INFO] [${timestamp}] ${message}`);
    }

    error(message) {
        const timestamp = new Date().toISOString();
        this.logs.push(`[ERROR] [${timestamp}] ${message}`);
    }

    setManualOrder(manualOrder) {
        this.usedManualOrder = true;
        this.manualModOrder = manualOrder;
    }

    addConflict(conflict) {
        this.conflicts.push(conflict);
    }

    getLogContent() {
        const endTime = new Date();
        const duration = (endTime - this.startTime) / 1000; // seconds
        
        let content = "IPM TOOL LOG\n";
        content += "=============\n\n";
        content += `Process started: ${this.startTime.toISOString()}\n`;
        content += `Process ended: ${endTime.toISOString()}\n`;
        content += `Duration: ${duration.toFixed(2)} seconds\n\n`;
        
        // Añadir información sobre el orden manual si se utilizó
        if (this.usedManualOrder) {
            content += "MANUAL MOD ORDER\n";
            content += "----------------\n";
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
            content += "CONFLICTS DETECTED\n";
            content += "------------------\n";
            this.conflicts.forEach((conflict, index) => {
                content += `Conflict Group ${index + 1}: Item "${conflict.itemName}"\n`;
                conflict.mods.forEach(mod => {
                    let modValues = [];
                    if (mod.count !== undefined) modValues.push(`Count: ${mod.count}`);
                    if (mod.value !== undefined) modValues.push(`Value: ${mod.value}`);
                    content += `  - ${mod.modId} (${modValues.join(', ')})\n`;
                });
                content += "\n";
            });
            content += "\n";
        }
        
        content += "PAK FILES PROCESSED\n";
        content += "------------------\n";
        if (this.pakFiles.length > 0) {
            content += this.pakFiles.map(file => `- ${file}`).join('\n');
        } else {
            content += "No PAK files were processed.";
        }
        content += "\n\n";
        
        content += "XML FILES PROCESSED\n";
        content += "------------------\n";
        if (this.xmlFiles.length > 0) {
            content += this.xmlFiles.map(file => `- ${file}`).join('\n');
        } else {
            content += "No XML files were processed.";
        }
        content += "\n\n";
        
        content += "MODS COMBINED\n";
        content += "-------------\n";
        if (this.combinedMods.size > 0) {
            for (const [modId, data] of this.combinedMods) {
                content += `- ${modId} (Priority: ${data.priority})\n`;
                content += `  Files: ${data.xmls.length}\n`;
            }
        } else {
            content += "No mods were combined.";
        }
        content += "\n\n";
        
        content += "PROCESS LOG\n";
        content += "-----------\n";
        if (this.logs.length > 0) {
            content += this.logs.join('\n');
        } else {
            content += "No log entries.";
        }
        
        return content;
    }
}

module.exports = Logger;