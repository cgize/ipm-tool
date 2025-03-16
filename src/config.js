// config.js
// Configuración centralizada para la aplicación IPM Tool

/**
 * Configuración de rutas y directorios
 */
const PATHS = {
    // Carpeta donde se generarán los archivos fusionados
    OUTPUT_FOLDER: 'zipmtool',
    // Ruta relativa para la carpeta Data dentro del output folder
    DATA_PATH: 'Data',
    // Nombre del archivo donde se guarda el orden de los mods
    MOD_ORDER_FILE: 'mod_order.txt',
    // Nombre del archivo de log
    LOG_FILE: 'ipmtool.log'
};

/**
 * Configuración de archivos y extensiones
 */
const FILES = {
    // Extensiones de archivo que se procesan
    PAK_EXTENSION: '.pak',
    XML_EXTENSION: '.xml',
    // Nombre del archivo pak generado
    OUTPUT_PAK_NAME: 'zipmtool.pak',
    // Ruta donde buscar archivos XML relevantes dentro de los PAK
    XML_SEARCH_PATH: 'Libs/Tables/item/',
    // Patrones de búsqueda para archivos relevantes
    XML_FILE_PATTERN: 'InventoryPreset',
    // Nombre del archivo XML generado
    OUTPUT_XML_NAME: 'Libs/Tables/item/InventoryPreset__ipmtool.xml'
};

/**
 * Configuración de la interfaz de usuario
 */
const UI = {
    // Dimensiones de ventanas
    MAIN_WINDOW: {
        WIDTH: 700,
        HEIGHT: 1000
    },
    CONFLICT_WINDOW: {
        WIDTH: 700,
        HEIGHT: 800
    },
    // Tiempos en milisegundos
    TIMEOUTS: {
        UI_UPDATE: 200
    }
};

/**
 * Configuración del analizador XML
 */
const XML = {
    // Opciones para el parser
    PARSER_OPTIONS: {
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        parseTagValue: true,
        parseAttributeValue: true,
        trimValues: true,
        allowBooleanAttributes: true
    },
    // Opciones para el builder
    BUILDER_OPTIONS: {
        ignoreAttributes: false,
        format: true,
        indentBy: "\t",
        attributeNamePrefix: "@_",
        suppressEmptyNode: true,         // Asegura que use sintaxis abreviada para nodos vacíos
        closingTagForEmptyElement: false, // Utiliza /> en lugar de </tag> para elementos vacíos
        suppressBooleanAttributes: false  // Mantener atributos booleanos
    },
    // Prefijos y nombres de atributos
    ATTRIBUTE_PREFIX: "@_",
    NAME_ATTRIBUTE: "@_Name",
    AMOUNT_ATTRIBUTE: "@_Amount",
    COUNT_ATTRIBUTE: "@_Count",
    VALUE_ATTRIBUTE: "@_Value",
    // Atributos adicionales para InventoryPresets
    MODE_ATTRIBUTE: "@_Mode",
    HEALTH_ATTRIBUTE: "@_Health",
    MODE_ALL_VALUE: "All",
    HEALTH_DEFAULT_VALUE: "1"
};

/**
 * Constantes para identificación de mods
 */
const MODS = {
    // ID del mod generado por la herramienta
    TOOL_MOD_ID: 'zipmtool',
    // Prefijo para mods provenientes de Steam Workshop
    STEAM_MOD_PREFIX: 'steam_'
};

/**
 * Mensajes de interfaz de usuario
 */
const MESSAGES = {
    NO_PAKS_FOUND: 'No PAK files were found in the specified paths',
    NO_XML_FOUND: 'No relevant XML files were found in the PAKs',
    PROCESS_COMPLETED: 'Ipmtool .pak file has been created and mod_order updated.',
    PROCESS_CANCELLED: 'Process cancelled by user',
    SELECT_MODS_PATH: 'Please select the Game Mods path',
    CONFLICTS_DETECTED: 'Se encontraron conflictos entre mods. Por favor, establece el orden de prioridad.'
};

/**
 * Configuración del mod generado
 */
const MOD_INFO = {
    NAME: "IPM Tool",
    MOD_ID: "zipmtool",
    DESCRIPTION: "App to merge xml inventorypreset",
    AUTHOR: "cgize",
    VERSION: "1.0",
    MODIFIES_LEVEL: "false"
};

/**
 * Métodos de resolución de conflictos
 */
const RESOLUTION_METHODS = {
    MANUAL: 'manual',
    HIGHEST_VALUE: 'highest-value',
    LOWEST_VALUE: 'lowest-value'
};

module.exports = {
    PATHS,
    FILES,
    UI,
    XML,
    MODS,
    MESSAGES,
    MOD_INFO,
    RESOLUTION_METHODS
};