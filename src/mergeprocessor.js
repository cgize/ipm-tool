const fs = require('fs').promises;
const path = require('path');
const yauzl = require('yauzl');
const xml2js = require('xml2js');
const AdmZip = require('adm-zip');

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

// Función  para buscar archivos .pak
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

// Función para obtener el orden de los mods
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

// Función  para extraer modId
async function extractModIdFromPak(pakFilePath) {
    const modFolder = path.dirname(path.dirname(pakFilePath));
    const manifestPath = path.join(modFolder, 'mod.manifest');
    try {
        await fs.access(manifestPath);
        const manifestContent = await fs.readFile(manifestPath, 'utf8');
        const parser = new xml2js.Parser({ explicitArray: false });
        const parsedManifest = await parser.parseStringPromise(manifestContent);

        if (parsedManifest?.kcd_mod?.info?.modid) {
            return parsedManifest.kcd_mod.info.modid;
        }
        if (parsedManifest?.kcd_mod?.info?.name) {
            return parsedManifest.kcd_mod.info.name.toLowerCase().replace(/\s+/g, '_');
        }
    } catch (error) {}
    
    const folderName = path.basename(modFolder);
    return folderName.toLowerCase().replace(/\s+/g, '_');
}

// Función  para extraer XMLs relevantes
async function extractRelevantXmls(pakFiles, modOrder, onProcessingFile) {
    const allXmls = [];

    for (const pakFile of pakFiles) {
        let modId;
        try {
            modId = await extractModIdFromPak(pakFile);
        } catch (error) {
            console.error(`Error obteniendo modId de ${pakFile}: ${error.message}`);
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
                                        priority: modOrder.indexOf(modId),
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
            console.error(`Error procesando ${pakFile}:`, error.message);
        }
    }

    // Ordenar por prioridad ascendente (menor índice = mayor prioridad)
    allXmls.sort((a, b) => b.priority - a.priority);
    
    return {
        xmls: allXmls,
        modIds: [...new Set(allXmls.map(xml => xml.modId))]
    };
}

// Función para combinar XMLs
async function combineXmls(xmlFiles) {
    const parser = new xml2js.Parser({
        explicitArray: true,
        preserveChildrenOrder: true,
        ignoreAttrs: false,
        preserveWhitespace: false,
        comment: false
    });

    const builder = new xml2js.Builder({
        renderOpts: { pretty: true, indent: '\t' },
        xmldec: { version: '1.0', encoding: 'us-ascii' }
    });

    const presetMap = new Map();

    for (const xmlFile of xmlFiles) {
        try {
            const parsed = await parser.parseStringPromise(xmlFile.content);
            const presets = parsed.database?.InventoryPresets?.[0]?.InventoryPreset;

            if (!presets) continue;

            const presetArray = Array.isArray(presets) ? presets : [presets];

            for (const preset of presetArray) {
                const presetName = preset.$.Name;
                if (!presetName) continue;

                if (!presetMap.has(presetName)) {
                    presetMap.set(presetName, {
                        attributes: preset.$,
                        elements: new Map()
                    });
                }

                const existingPreset = presetMap.get(presetName);

                Object.keys(preset).forEach(childType => {
                    if (childType === '$') return;

                    if (!existingPreset.elements.has(childType)) {
                        existingPreset.elements.set(childType, new Map());
                    }

                    const elements = Array.isArray(preset[childType]) ? preset[childType] : [preset[childType]];
                    
                    elements.forEach(element => {
                        const key = generateElementKey(element);
                        existingPreset.elements.get(childType).set(key, element);
                    });
                });
            }
        } catch (err) {
            console.error(`Error procesando ${xmlFile.fileName}:`, err);
        }
    }

    const combinedXml = {
        database: {
            '$': {
                'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
                'name': 'barbora',
                'xsi:noNamespaceSchemaLocation': 'InventoryPreset.xsd'
            },
            InventoryPresets: {
                '$': { version: '2' },
                InventoryPreset: Array.from(presetMap.values()).map(preset => {
                    const result = { '$': preset.attributes };
                    preset.elements.forEach((elementsMap, childType) => {
                        result[childType] = Array.from(elementsMap.values()).map(element => {
                            // Correción clave: Manejar texto opcional
                            const obj = { $: element.$ };
                            if (element._) obj._ = element._;
                            return obj;
                        });
                    });
                    return result;
                })
            }
        }
    };

    return builder.buildObject(combinedXml);
}

// Función clave de elemento
function generateElementKey(element) {
    const attrs = element.$ || {};
    const sortedKeys = Object.keys(attrs).sort();
    return sortedKeys.map(key => `${key}=${attrs[key]}`).join('|');
}

// Funciones auxiliares
async function ensureDirectoryExists(dirPath) {
    try {
        await fs.access(dirPath);
    } catch (error) {
        await fs.mkdir(dirPath, { recursive: true });
    }
}

async function createIpmPak(combinedXml, modsPath) {
    const ipmDataPath = path.join(modsPath, 'ipmtool', 'Data');
    await ensureDirectoryExists(ipmDataPath);

    const zip = new AdmZip();
    zip.addFile('Libs/Tables/item/InventoryPreset__ipmtool.xml', Buffer.from(combinedXml));
    
    await fs.writeFile(path.join(ipmDataPath, 'ipmtool.pak'), zip.toBuffer());
}

async function createModManifest(modsPath) {
    const ipmPath = path.join(modsPath, 'ipmtool');
    await ensureDirectoryExists(ipmPath);

    const manifestContent = {
        kcd_mod: {
            info: {
                name: 'IPM Tool',
                modid: 'ipmtool',
                description: 'App to merge xml inventorypreset',
                author: 'cgize',
                version: '1.0',
                created_on: '',
                modifies_level: 'false'
            }
        }
    };

    const builder = new xml2js.Builder({
        renderOpts: { pretty: true, indent: '\t' },
        xmldec: { version: '1.0', encoding: 'us-ascii' }
    });

    const xml = builder.buildObject(manifestContent);
    await fs.writeFile(path.join(ipmPath, 'mod.manifest'), xml);
}

async function updateModOrder(modsPath) {
    const modOrderPath = path.join(modsPath, 'mod_order.txt');
    let modOrder = '';
    try {
        modOrder = await fs.readFile(modOrderPath, 'utf8');
    } catch (e) {}

    if (!modOrder.includes('ipmtool')) {
        modOrder += '\nipmtool';
        await fs.writeFile(modOrderPath, modOrder.trim());
    }
}

// Función principal
async function searchAndMerge(modsPath, options = {}) {
    const logger = new Logger();
    
    try {
        logger.info(`Iniciando proceso en: ${modsPath}`);
        const modOrder = await getModOrder(modsPath);
        logger.info(`Orden de mods detectado: ${modOrder.join(', ') || 'Ninguno'}`);

        const pakFiles = await findPakFiles(modsPath);
        logger.pakFiles = pakFiles;
        logger.info(`Archivos PAK encontrados: ${pakFiles.length}`);

        if (pakFiles.length === 0) {
            throw new Error('No PAK files were found in the specified path');
        }

        const { xmls: xmlFiles, modIds } = await extractRelevantXmls(pakFiles, modOrder, (fileName) => {
            logger.xmlFiles.push(fileName);
            options.onProcessingFile?.(fileName);
        });

        xmlFiles.forEach(xml => {
            const modData = logger.combinedMods.get(xml.modId) || { priority: xml.priority, xmls: [] };
            modData.xmls.push(xml.fileName);
            logger.combinedMods.set(xml.modId, modData);
        });

        logger.info(`XMLs relevantes procesados: ${xmlFiles.length}`);
        
        if (xmlFiles.length === 0) {
            throw new Error('No relevant XML files were found in the PAKs');
        }

        const combinedXml = await combineXmls(xmlFiles);
        await createIpmPak(combinedXml, modsPath);
        await createModManifest(modsPath);
        await updateModOrder(modsPath);

        logger.info('Proceso completado exitosamente');
        
        return { 
            success: true, 
            message: 'The IPM PAK file has been created and mod_order updated.',
            combinedMods: modIds,
            logContent: logger.getLogContent() // Nuevo campo
        };
    } catch (error) {
        logger.error(`Error: ${error.message}`);
        console.error(error);
        return {
            success: false,
            message: `Error: ${error.message}`,
            logContent: logger.getLogContent()
        };
    }
}

module.exports = { searchAndMerge };