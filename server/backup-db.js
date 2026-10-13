const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

async function backup() {
    const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
    const databasePath = path.join(dataDir, 'projects.db');
    const backupDir = path.resolve(process.env.BACKUP_DIR || path.join(dataDir, 'backups'));
    const keepCount = Math.max(1, Number.parseInt(process.env.BACKUP_KEEP || '14', 10) || 14);

    fs.mkdirSync(backupDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const backupPath = path.join(backupDir, `projects-${timestamp}.db`);
    const database = new Database(databasePath, { readonly: true, fileMustExist: true });

    try {
        await database.backup(backupPath);
    } finally {
        database.close();
    }

    const backups = fs.readdirSync(backupDir)
        .filter(name => /^projects-\d{8}T\d{6}Z\.db$/.test(name))
        .sort();

    for (const oldBackup of backups.slice(0, Math.max(0, backups.length - keepCount))) {
        fs.unlinkSync(path.join(backupDir, oldBackup));
    }

    console.log(`SQLite backup created at ${backupPath}`);
}

backup().catch(error => {
    console.error('Database backup failed:', error.message);
    process.exitCode = 1;
});
