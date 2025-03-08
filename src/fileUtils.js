const fs = require('fs').promises;
const path = require('path');
const yauzl = require('yauzl');
const { XMLParser } = require('fast-xml-parser');

async function findPakFiles(modsPath) {
    async function searchDir(dir) {
        let pakFiles = [];
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                pakFiles = pakFiles.concat(await searchDir(fullPath));
            } else if (entry.isFile() && entry.name.endsWith('.pak')) {
                pakFiles.push(fullPath);
            }
        }
        return pakFiles;
    }

    return await searchDir(modsPath);
}

async function getModOrder(modsPath) {
    const modOrderPath = path.join(modsPath, 'mod_order.txt');
    try {
        const content = await fs.readFile(modOrderPath, 'utf8');
        return content
            .split('\n')
            .filter(line => line.trim() !== '')
            .map(line => line.trim());
    } catch (error) {
        return [];
    }
}

async function extractModIdFromPak(pakFilePath) {
    const modFolder = path.dirname(path.dirname(pakFilePath));
    const manifestPath = path.join(modFolder, 'mod.manifest');
    try {
        await fs.access(manifestPath);
        const manifestContent = await fs.readFile(manifestPath, 'utf8');
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: "@_"
        });
        const parsedManifest = parser.parse(manifestContent);

        if (parsedManifest?.kcd_mod?.info?.["@_modid"]) {
            return parsedManifest.kcd_mod.info["@_modid"];
        }
        if (parsedManifest?.kcd_mod?.info?.["@_name"]) {
            return parsedManifest.kcd_mod.info["@_name"].toLowerCase().replace(/\s+/g, '_');
        }
    } catch (error) {}
    
    const folderName = path.basename(modFolder);
    return folderName.toLowerCase().replace(/\s+/g, '_');
}

async function extractRelevantXmls(pakFiles, modOrder, onProcessingFile) {
    const allXmls = [];

    for (const pakFile of pakFiles) {
        let modId;
        try {
            modId = await extractModIdFromPak(pakFile);
        } catch (error) {
            console.error(`Error getting modId from ${pakFile}: ${error.message}`);
            modId = null;
        }

        try {
            await new Promise((resolve, reject) => {
                yauzl.open(pakFile, { lazyEntries: true }, (err, zip) => {
                    if (err) return reject(err);

                    zip.on('entry', (entry) => {
                        if (entry.fileName.startsWith('Libs/Tables/item/') &&
                            entry.fileName.includes('InventoryPreset__') &&
                            entry.fileName.endsWith('.xml')) {

                            zip.openReadStream(entry, async (err, readStream) => {
                                if (err) return;
                                if (onProcessingFile) onProcessingFile(entry.fileName);

                                let xmlContent = '';
                                readStream.on('data', (chunk) => xmlContent += chunk);
                                readStream.on('end', () => {
                                    allXmls.push({
                                        content: xmlContent,
                                        modId: modId,
                                        priority: modOrder.length - modOrder.indexOf(modId),
                                        fileName: entry.fileName
                                    });
                                    
                                    zip.readEntry();
                                });
                            });
                        } else {
                            zip.readEntry();
                        }
                    });

                    zip.on('end', () => resolve());
                    zip.readEntry();
                });
            });
        } catch (error) {
            console.error(`Error processing ${pakFile}:`, error.message);
        }
    }

    allXmls.sort((a, b) => b.priority - a.priority);
    
    return {
        xmls: allXmls,
        modIds: [...new Set(allXmls.map(xml => xml.modId))]
    };
}

module.exports = {
    findPakFiles,
    getModOrder,
    extractModIdFromPak,
    extractRelevantXmls
};