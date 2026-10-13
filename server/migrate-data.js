const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const SITE_ROOT = path.resolve(__dirname, '..');
const SOURCE_DB = path.join(__dirname, 'data', 'projects.db');
const LEGACY_IMAGES = path.join(SITE_ROOT, 'assets', 'images', 'projects');

function isWithin(parent, candidate) {
    const relative = path.relative(parent, candidate);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function migrate() {
    const configuredDataDir = process.env.DATA_DIR;
    if (!configuredDataDir) {
        throw new Error('Set DATA_DIR to a persistent directory outside the Git checkout.');
    }

    const dataDir = path.resolve(configuredDataDir);
    const uploadsDir = path.resolve(process.env.UPLOADS_DIR || path.join(dataDir, 'uploads'));
    const targetDbPath = path.join(dataDir, 'projects.db');

    if (isWithin(SITE_ROOT, dataDir) || isWithin(SITE_ROOT, uploadsDir)) {
        throw new Error('DATA_DIR and UPLOADS_DIR must both be outside the Git checkout.');
    }
    if (!fs.existsSync(SOURCE_DB)) {
        throw new Error(`Legacy database not found: ${SOURCE_DB}`);
    }
    if (fs.existsSync(targetDbPath)) {
        throw new Error(`Refusing to overwrite existing database: ${targetDbPath}`);
    }

    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(uploadsDir, { recursive: true });

    const imageFiles = fs.existsSync(LEGACY_IMAGES)
        ? fs.readdirSync(LEGACY_IMAGES, { withFileTypes: true }).filter(entry => entry.isFile())
        : [];

    for (const entry of imageFiles) {
        const sourcePath = path.join(LEGACY_IMAGES, entry.name);
        const destinationPath = path.join(uploadsDir, entry.name);
        if (fs.existsSync(destinationPath)) {
            throw new Error(`Refusing to overwrite existing upload: ${destinationPath}`);
        }
        fs.copyFileSync(sourcePath, destinationPath);
    }

    const sourceDb = new Database(SOURCE_DB, { readonly: true, fileMustExist: true });
    try {
        await sourceDb.backup(targetDbPath);
    } finally {
        sourceDb.close();
    }

    console.log(`Copied the SQLite database to ${targetDbPath}`);
    console.log(`Copied ${imageFiles.length} project image files to ${uploadsDir}`);
    console.log('Original database and image files were left untouched.');
}

migrate().catch(error => {
    console.error('Data migration failed:', error.message);
    process.exitCode = 1;
});
