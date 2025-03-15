class Logger {
    constructor() {
        this.logs = [];
        this.pakFiles = [];
        this.xmlFiles = [];
        this.combinedMods = new Map();
        this.startTime = new Date();
    }

    info(message) {
        const timestamp = new Date().toISOString();
        this.logs.push(`[INFO] [${timestamp}] ${message}`);
    }

    error(message) {
        const timestamp = new Date().toISOString();
        this.logs.push(`[ERROR] [${timestamp}] ${message}`);
    }

    getLogContent() {
        const endTime = new Date();
        const duration = (endTime - this.startTime) / 1000; // seconds
        
        let content = "IPM TOOL LOG\n";
        content += "=============\n\n";
        content += `Process started: ${this.startTime.toISOString()}\n`;
        content += `Process ended: ${endTime.toISOString()}\n`;
        content += `Duration: ${duration.toFixed(2)} seconds\n\n`;
        
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