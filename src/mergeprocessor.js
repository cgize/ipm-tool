// mergeprocessor.js
// Módulo principal para el procesamiento y fusión de mods

const fs = require('fs').promises;
const path = require('path');
const AdmZip = require('adm-zip');
const { XMLBuilder } = require('fast-xml-parser');
const Logger = require('./logger');
const { findPakFiles, getModOrder, extractRelevantXmls } = require('./fileUtils');
const { combineXmls } = require('./xmlCombiner');
const config = require('./config');

/**
 * Crea el directorio si no existe
 * @param {string} dirPath - Ruta del directorio a crear
 * @returns {Promise<void>}
 */
async function ensureDirectoryExists(dirPath) {
    try {
        await fs.access(dirPath);
    } catch (error) {
        if (error.code === 'ENOENT') {
            try {
                await fs.mkdir(dirPath, { recursive: true });
            } catch (mkdirError) {
                throw new Error(`Failed to create directory ${dirPath}: ${mkdirError.message}`);
            }
        } else {
            throw new Error(`Error accessing directory ${dirPath}: ${error.message}`);
        }
    }
}

/**
 * Crea el archivo .pak con el XML combinado
 * @param {string} combinedXml - Contenido XML combinado
 * @param {string} modsPath - Ruta base de los mods
 * @param {Logger} logger - Instancia del logger
 * @returns {Promise<void>}
 */
async function createIpmPak(combinedXml, modsPath, logger) {
    const ipmDataPath = path.join(modsPath, config.PATHS.OUTPUT_FOLDER, config.PATHS.DATA_PATH);
    try {
        await ensureDirectoryExists(ipmDataPath);
        
        const zip = new AdmZip();
        zip.addFile(config.FILES.OUTPUT_XML_NAME, Buffer.from(combinedXml));
        
        const outputPath = path.join(ipmDataPath, config.FILES.OUTPUT_PAK_NAME);
        await fs.writeFile(outputPath, zip.toBuffer());
        
        logger.info(`Created PAK file at ${outputPath}`);
    } catch (error) {
        logger.error(`Failed to create IPM PAK file: ${error.message}`);
        throw error;
    }
}

/**
 * Crea el manifiesto del mod en la carpeta de salida
 * @param {string} modsPath - Ruta base de los mods
 * @param {Logger} logger - Instancia del logger
 * @returns {Promise<void>}
 */
async function createModManifest(modsPath, logger) {
    try {
        // Construye la ruta completa donde se guardará el mod
        const ipmPath = path.join(modsPath, config.PATHS.OUTPUT_FOLDER);
        
        // Crea los directorios necesarios si no existen
        await ensureDirectoryExists(ipmPath);

        // Define la estructura del archivo mod.manifest
        const manifestContent = {
            kcd_mod: {
                info: {
                    "name": config.MOD_INFO.NAME,
                    "modid": config.MOD_INFO.MOD_ID,
                    "description": config.MOD_INFO.DESCRIPTION,
                    "author": config.MOD_INFO.AUTHOR,
                    "version": config.MOD_INFO.VERSION,
                    "created_on": new Date().toISOString().split('T')[0],
                    "modifies_level": config.MOD_INFO.MODIFIES_LEVEL
                }
            }
        };

        // Configura el generador de XML
        const builder = new XMLBuilder({
            format: true,
            indentBy: "\t",
            suppressEmptyNode: true,
            closingTagForEmptyElement: false,
            ignoreAttributes: false,
            attributeNamePrefix: "@_"
        });

        // Agrega la declaración XML al inicio del documento
        let xml = '<?xml version="1.0" encoding="us-ascii"?>\n';
        xml += builder.build(manifestContent);
        
        const manifestPath = path.join(ipmPath, 'mod.manifest');
        await fs.writeFile(manifestPath, xml);
        
        logger.info(`Created mod manifest at ${manifestPath}`);
    } catch (error) {
        logger.error(`Failed to create mod manifest: ${error.message}`);
        throw error;
    }
}

/**
 * Actualiza el archivo mod_order.txt para incluir el mod de la herramienta
 * Solo si el archivo ya existe, no lo crea si no existe
 * @param {string} modsPath - Ruta base de los mods
 * @param {Logger} logger - Instancia del logger
 * @returns {Promise<void>}
 */
async function updateModOrder(modsPath, logger) {
    const modOrderPath = path.join(modsPath, config.PATHS.MOD_ORDER_FILE);
    
    try {
        let modOrderContent;
        let modOrderExists = true;
        
        try {
            // Intentar leer el archivo existente
            modOrderContent = await fs.readFile(modOrderPath, 'utf8');
        } catch (readError) {
            // Si el archivo no existe, registrar y salir
            if (readError.code === 'ENOENT') {
                logger.info(`No mod_order.txt found. Skipping update.`);
                return; // Salir sin crear el archivo
            } else {
                // Otro tipo de error
                throw readError;
            }
        }

        // Si llegamos aquí, el archivo existe, hacer una copia de seguridad
        try {
            await fs.writeFile(`${modOrderPath}.bak`, modOrderContent);
            logger.info(`Created backup of mod_order.txt`);
        } catch (backupError) {
            logger.warn(`Failed to create backup of mod_order.txt: ${backupError.message}`);
            // Continuar a pesar del error en la copia de seguridad
        }

        // Dividir en líneas y eliminar líneas vacías
        const modOrderLines = modOrderContent.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);

        // Verificar si el ID de la herramienta ya está en la lista
        if (!modOrderLines.includes(config.MODS.TOOL_MOD_ID)) {
            modOrderLines.push(config.MODS.TOOL_MOD_ID);
            await fs.writeFile(modOrderPath, modOrderLines.join('\n'));
            logger.info(`Updated mod_order.txt: Added ${config.MODS.TOOL_MOD_ID}`);
        } else {
            logger.info(`mod_order.txt already contains ${config.MODS.TOOL_MOD_ID}`);
        }
    } catch (error) {
        logger.error(`Error updating mod_order.txt: ${error.message}`);
        throw error;
    }
}

/**
 * Función principal para buscar y fusionar mods
 * @param {string} modsPath - Ruta base de los mods
 * @param {Object} options - Opciones de procesamiento
 * @returns {Promise<Object>} - Resultado del procesamiento
 */
async function searchAndMerge(modsPath, options = {}) {
    const logger = new Logger();
    const { 
        onProcessingFile, 
        combineOnlyConflicts = false, 
        steamModsPath = null,
        manualModOrder = null,
        resolutionMethod = config.RESOLUTION_METHODS.MANUAL
    } = options;

    try {
        logger.info(`Starting process in: ${modsPath}`);
        logger.info(`Resolution method: ${resolutionMethod}`);
        
        // Registrar información de Steam Workshop si se proporciona
        if (steamModsPath) {
            logger.info(`Including Steam Workshop mods from: ${steamModsPath}`);
        }
        
        // Obtener orden de mods existente
        const modOrderData = await getModOrder(modsPath);
        logger.info(`Detected mod order: ${modOrderData.modOrder.join(', ') || 'None'}`);
        logger.info(`Mod order file exists: ${modOrderData.exists ? 'Yes' : 'No'}`);

        // Buscar archivos PAK
        const pakFiles = await findPakFiles(modsPath, steamModsPath);
        logger.pakFiles = pakFiles;
        logger.info(`PAK files found: ${pakFiles.length}`);

        if (pakFiles.length === 0) {
            throw new Error(config.MESSAGES.NO_PAKS_FOUND);
        }

        // Extraer XMLs relevantes de los archivos PAK
        const extractResult = await extractRelevantXmls(pakFiles, modOrderData, (fileName) => {
            logger.xmlFiles.push(fileName);
            onProcessingFile?.(fileName);
        });

        const { xmls: xmlFiles, modIds, conflicts, needsManualOrder, modDetails } = extractResult;

        // Registrar información de los mods en el logger
        xmlFiles.forEach(xml => {
            const modData = logger.combinedMods.get(xml.modId) || { priority: xml.priority, xmls: [] };
            modData.xmls.push(xml.fileName);
            logger.combinedMods.set(xml.modId, modData);
        });

        logger.info(`Relevant XMLs processed: ${xmlFiles.length}`);
        logger.info(`Conflicts detected: ${conflicts.length}`);

        if (xmlFiles.length === 0) {
            throw new Error(config.MESSAGES.NO_XML_FOUND);
        }

        // Comprobar si necesitamos ordenación manual
        if (needsManualOrder && !modOrderData.exists && !manualModOrder && resolutionMethod === config.RESOLUTION_METHODS.MANUAL) {
            // Devolver información para la interfaz de resolución de conflictos
            return {
                success: false,
                needsManualOrder: true,
                conflicts: conflicts,
                modDetails: Array.from(modDetails.values()),
                message: config.MESSAGES.CONFLICTS_DETECTED,
                logContent: logger.getLogContent()
            };
        }

        // Combinar los XMLs según las opciones especificadas
        const result = await combineXmls(xmlFiles, {
            combineOnlyConflicts,
            manualModOrder,
            resolutionMethod
        });
        
        const combinedXml = result.xml;
        const includedModIds = result.includedModIds;
        
        // Crear los archivos de salida
        await createIpmPak(combinedXml, modsPath, logger);
        await createModManifest(modsPath, logger);
        await updateModOrder(modsPath, logger);

        // Registrar información adicional en el log
        if (manualModOrder && manualModOrder.length > 0) {
            logger.setManualOrder(manualModOrder);
            logger.info(`Used manual mod order: ${manualModOrder.join(', ')}`);
        }
        
        logger.info(`Used resolution method: ${resolutionMethod}`);
        logger.info(`Mods included in the combined output: ${includedModIds.join(', ')}`);
        logger.info('Process completed successfully');

        return {
            success: true,
            message: config.MESSAGES.PROCESS_COMPLETED,
            combinedMods: includedModIds,
            logContent: logger.getLogContent()
        };
    } catch (error) {
        logger.error(`${error.message}`);
        console.error(error);
        return {
            success: false,
            message: `${error.message}`,
            logContent: logger.getLogContent()
        };
    }
}

module.exports = { 
    searchAndMerge,
    ensureDirectoryExists,
    createIpmPak,
    createModManifest,
    updateModOrder
};