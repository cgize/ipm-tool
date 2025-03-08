// logger.js
class Logger {
    constructor() {
        this.logs = [];
        this.pakFiles = [];
        this.xmlFiles = [];
        this.combinedMods = new Map();
    }

    log(type, message) {
        const timestamp = new Date().toISOString();
        this.logs.push(`[${timestamp}] [${type.toUpperCase()}] ${message}`);
    }

    info(message) {
        this.log('info', message);
    }

    error(message) {
        this.log('error', message);
    }

    getLogContent() {
        return [
            "=== IPM Tool Log ===",
            `Generated: ${new Date().toLocaleString()}`,
            "\n== PAK Files Found ==\n" + this.pakFiles.join('\n'),
            "\n== XML Files Processed ==\n" + this.xmlFiles.join('\n'),
            "\n== Mod Processing Details ==\n" + [...this.combinedMods].map(([mod, {priority, xmls}]) => 
                `Mod: ${mod} | Priority: ${priority}\nXMLs: ${xmls.join(', ')}`
            ).join('\n'),
            "\n== Execution Log ==\n" + this.logs.join('\n')
        ].join('\n');
    }
}

module.exports = Logger;