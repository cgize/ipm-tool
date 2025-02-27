const fs = require('fs').promises;
const path = require('path');
const yauzl = require('yauzl');
const xml2js = require('xml2js');
const AdmZip = require('adm-zip');

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
        const parser = new xml2js.Parser({ explicitArray: false });
        const parsedManifest = await parser.parseStringPromise(manifestContent);

        // Se asume que el manifest tiene la estructura:
        // <kcd_mod>
        //    <info>
        //       <modid>...</modid>
        //       <name>...</name>
        //       ...
        //    </info>
        // </kcd_mod>
        if (parsedManifest?.kcd_mod?.info?.modid) {
            return parsedManifest.kcd_mod.info.modid;
        }
        if (parsedManifest?.kcd_mod?.info?.name) {
            return parsedManifest.kcd_mod.info.name.toLowerCase().replace(/\s+/g, '_');
        }
    } catch (error) {
        // Si no se encuentra mod.manifest o ocurre algún error, se usa el nombre de la carpeta.
    }
    const folderName = path.basename(modFolder);
    return folderName.toLowerCase().replace(/\s+/g, '_');
}


function extractModIdFromXml(xmlFileName) {
    const match = xmlFileName.match(/InventoryPreset__(.*?)\.xml/);
    return match ? match[1] : null;
}

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
                                        priority: modOrder.indexOf(modId) !== -1 ? modOrder.indexOf(modId) : Infinity,
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

    allXmls.sort((a, b) => b.priority - a.priority);
    
    return {
        xmls: allXmls,
        modIds: [...new Set(allXmls.map(xml => xml.modId))] // ModIds únicos
    };
}

async function combineXmls(xmlFiles) {
    const parser = new xml2js.Parser({
        explicitArray: true,
        mergeAttrs: false,
        preserveChildrenOrder: true,
        ignoreAttrs: false
    });
    const builder = new xml2js.Builder({
        renderOpts: { pretty: true, indent: '\t' },
        xmldec: { version: '1.0', encoding: 'us-ascii' }
    });

    // Primero agrupamos todos los InventoryPreset por su atributo Name
    const presetGroups = new Map();

    for (const xmlFile of xmlFiles) {
        try {
            const parsed = await parser.parseStringPromise(xmlFile.content);
            const presets = parsed.database?.InventoryPresets?.[0]?.InventoryPreset;
            if (!presets) continue;
            const presetArray = Array.isArray(presets) ? presets : [presets];
            for (const preset of presetArray) {
                const presetName = preset.$.Name;
                if (!presetName) continue;
                if (!presetGroups.has(presetName)) {
                    presetGroups.set(presetName, []);
                }
                presetGroups.get(presetName).push(preset);
            }
        } catch (err) {
            console.error(`Error procesando ${xmlFile.fileName}:`, err);
        }
    }

    // Ahora procesamos cada grupo
    const mergedPresets = [];
    for (const [presetName, presets] of presetGroups.entries()) {
        if (presets.length === 1) {
            // Si solo aparece una vez, usamos la entrada tal cual
            mergedPresets.push(presets[0]);
        } else {
            // Si hay múltiples, elegimos como base la que tenga más nodos hijos (más completa)
            let base = presets[0];
            for (const p of presets) {
                const countBase = Object.keys(base).filter(k => k !== '$').length;
                const countP = Object.keys(p).filter(k => k !== '$').length;
                if (countP > countBase) {
                    base = p;
                }
            }
            // Luego, recorremos las otras ocurrencias y fusionamos nodos que falten en la base
            for (const p of presets) {
                if (p === base) continue;
                for (const childType in p) {
                    if (childType === '$') continue;
                    // Si la base no tiene ese tipo de nodo, lo copiamos entero
                    if (!base[childType]) {
                        base[childType] = p[childType];
                    } else {
                        // Si ya existe, aseguramos que cada elemento de p[childType] esté presente en la base
                        const baseArr = Array.isArray(base[childType]) ? base[childType] : [base[childType]];
                        const pArr = Array.isArray(p[childType]) ? p[childType] : [p[childType]];
                        for (const elem of pArr) {
                            // Comparamos usando JSON.stringify de los atributos (asumiendo que el orden de las claves sea consistente)
                            const exists = baseArr.some(e => JSON.stringify(e.$) === JSON.stringify(elem.$));
                            if (!exists) {
                                baseArr.push(elem);
                            }
                        }
                        base[childType] = baseArr;
                    }
                }
            }
            mergedPresets.push(base);
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
                InventoryPreset: mergedPresets
            }
        }
    };

    return builder.buildObject(combinedXml);
}

function generateElementKey(element) {
    return element.$?.Name || element.$?.Ref || JSON.stringify(element.$);
}

function generateElementKey(element) {
    if (element.$.Name) {
        return `${element.$.Name}|${element.$.Quality || ''}|${element.$.Condition || ''}`;
    }
    if (element.$.Ref) {
        return element.$.Ref;
    }
    return JSON.stringify(element.$);
}

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
    } catch (e) {

    }
    
    if (!modOrder.includes('ipmtool')) {
        modOrder += '\nipmtool';
        await fs.writeFile(modOrderPath, modOrder.trim());
    }
}

async function searchAndMerge(modsPath, options = {}) {
    try {
        const modOrder = await getModOrder(modsPath);
        const pakFiles = await findPakFiles(modsPath);

        if (pakFiles.length === 0) {
            throw new Error('No PAK files were found in the specified path');
        }

        const { xmls: xmlFiles, modIds } = await extractRelevantXmls(pakFiles, modOrder, options.onProcessingFile);
        
        if (xmlFiles.length === 0) {
            throw new Error('No relevant XML files were found in the PAKs');
        }

        const combinedXml = await combineXmls(xmlFiles);
        await createIpmPak(combinedXml, modsPath);
        await createModManifest(modsPath);
        await updateModOrder(modsPath);

        return { 
            success: true, 
            message: 'The IPM PAK file has been created and mod_order updated.',
            combinedMods: modIds
        };
    } catch (error) {
        console.error(error);
        throw new Error(`Error: ${error.message}`);
    }
}

module.exports = { searchAndMerge };