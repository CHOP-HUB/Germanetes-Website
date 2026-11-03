const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'projects.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ─────────────────────────────────────────────

db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL CHECK(category IN ('permanent', 'temporal', 'collaborations', 'historic')),
        thumbnail TEXT DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        subtitle_ca TEXT NOT NULL DEFAULT '',
        subtitle_es TEXT NOT NULL DEFAULT '',
        subtitle_en TEXT NOT NULL DEFAULT '',
        short_desc_ca TEXT NOT NULL DEFAULT '',
        short_desc_es TEXT NOT NULL DEFAULT '',
        short_desc_en TEXT NOT NULL DEFAULT '',
        detail_desc_ca TEXT NOT NULL DEFAULT '',
        detail_desc_es TEXT NOT NULL DEFAULT '',
        detail_desc_en TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS project_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        image_path TEXT NOT NULL,
        caption_ca TEXT DEFAULT '',
        caption_es TEXT DEFAULT '',
        caption_en TEXT DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0
    );
`);

function migrateProjectsTable() {
    const columns = new Set(db.pragma('table_info(projects)').map(column => column.name));
    const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'projects'").get().sql;
    const hasNewCategoryCheck = tableSql.includes("'permanent'") && tableSql.includes("'collaborations'") && tableSql.includes("'historic'");
    const hasSubtitles = ['subtitle_ca', 'subtitle_es', 'subtitle_en'].every(column => columns.has(column));
    if (hasNewCategoryCheck && hasSubtitles) return;

    const subtitleValue = column => columns.has(column) ? column : "''";
    db.pragma('foreign_keys = OFF');
    try {
        db.transaction(() => {
            db.exec(`
                CREATE TABLE projects_migration (
                    id TEXT PRIMARY KEY,
                    category TEXT NOT NULL CHECK(category IN ('permanent', 'temporal', 'collaborations', 'historic')),
                    thumbnail TEXT DEFAULT '',
                    title TEXT NOT NULL DEFAULT '',
                    subtitle_ca TEXT NOT NULL DEFAULT '',
                    subtitle_es TEXT NOT NULL DEFAULT '',
                    subtitle_en TEXT NOT NULL DEFAULT '',
                    short_desc_ca TEXT NOT NULL DEFAULT '',
                    short_desc_es TEXT NOT NULL DEFAULT '',
                    short_desc_en TEXT NOT NULL DEFAULT '',
                    detail_desc_ca TEXT NOT NULL DEFAULT '',
                    detail_desc_es TEXT NOT NULL DEFAULT '',
                    detail_desc_en TEXT NOT NULL DEFAULT '',
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                INSERT INTO projects_migration (
                    id, category, thumbnail, title, subtitle_ca, subtitle_es, subtitle_en,
                    short_desc_ca, short_desc_es, short_desc_en,
                    detail_desc_ca, detail_desc_es, detail_desc_en,
                    sort_order, created_at, updated_at
                )
                SELECT
                    id,
                    CASE category
                        WHEN 'ongoing' THEN 'permanent'
                        WHEN 'archive' THEN 'historic'
                        ELSE category
                    END,
                    thumbnail, title,
                    ${subtitleValue('subtitle_ca')}, ${subtitleValue('subtitle_es')}, ${subtitleValue('subtitle_en')},
                    short_desc_ca, short_desc_es, short_desc_en,
                    detail_desc_ca, detail_desc_es, detail_desc_en,
                    sort_order, created_at, updated_at
                FROM projects;

                DROP TABLE projects;
                ALTER TABLE projects_migration RENAME TO projects;
            `);
        })();
    } finally {
        db.pragma('foreign_keys = ON');
    }

    const foreignKeyErrors = db.pragma('foreign_key_check');
    if (foreignKeyErrors.length) {
        throw new Error('Project table migration left invalid image references.');
    }
}

migrateProjectsTable();

if (!db.pragma('table_info(projects)').some(column => column.name === 'instagram')) {
    db.exec("ALTER TABLE projects ADD COLUMN instagram TEXT NOT NULL DEFAULT ''");
}

// Accepts "@handle", "handle" or an instagram.com profile URL and keeps only the handle.
function normalizeInstagram(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const handle = text
        .replace(/^https?:\/\/(?:www\.)?instagram\.com\//i, '')
        .replace(/^@/, '')
        .split(/[/?#]/)[0];
    return /^[A-Za-z0-9._]{1,30}$/.test(handle) ? handle : '';
}

db.exec(`
    CREATE TABLE IF NOT EXISTS gallery_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        image_path TEXT NOT NULL,
        size INTEGER NOT NULL DEFAULT 1 CHECK(size IN (1, 2, 3)),
        caption_ca TEXT NOT NULL DEFAULT '',
        caption_es TEXT NOT NULL DEFAULT '',
        caption_en TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bulletins (
        month TEXT PRIMARY KEY CHECK(month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
        image_path TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS material_nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_id INTEGER REFERENCES material_nodes(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK(type IN ('folder', 'file')),
        name_ca TEXT NOT NULL DEFAULT '',
        name_es TEXT NOT NULL DEFAULT '',
        name_en TEXT NOT NULL DEFAULT '',
        file_path TEXT NOT NULL DEFAULT '',
        file_size INTEGER NOT NULL DEFAULT 0,
        file_ext TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
`);

const PROJECT_CATEGORIES = new Set(['permanent', 'temporal', 'collaborations', 'historic']);

function normalizeCategory(category) {
    const mapped = { ongoing: 'permanent', archive: 'historic' }[category] || category || 'permanent';
    if (!PROJECT_CATEGORIES.has(mapped)) throw new Error('Invalid project category');
    return mapped;
}

// ── Prepared Statements ────────────────────────────────

const stmts = {
    getAllProjects: db.prepare(`
        SELECT * FROM projects ORDER BY sort_order ASC, created_at DESC
    `),

    getProjectById: db.prepare(`
        SELECT * FROM projects WHERE id = ?
    `),

    getProjectImages: db.prepare(`
        SELECT * FROM project_images WHERE project_id = ? ORDER BY sort_order ASC
    `),

    insertProject: db.prepare(`
        INSERT INTO projects (id, category, thumbnail, title, subtitle_ca, subtitle_es, subtitle_en, instagram,
            short_desc_ca, short_desc_es, short_desc_en,
            detail_desc_ca, detail_desc_es, detail_desc_en, sort_order)
        VALUES (@id, @category, @thumbnail, @title, @subtitle_ca, @subtitle_es, @subtitle_en, @instagram,
            @short_desc_ca, @short_desc_es, @short_desc_en,
            @detail_desc_ca, @detail_desc_es, @detail_desc_en, @sort_order)
    `),

    updateProject: db.prepare(`
        UPDATE projects SET
            category = @category,
            thumbnail = @thumbnail,
            title = @title,
            subtitle_ca = @subtitle_ca,
            subtitle_es = @subtitle_es,
            subtitle_en = @subtitle_en,
            instagram = @instagram,
            short_desc_ca = @short_desc_ca,
            short_desc_es = @short_desc_es,
            short_desc_en = @short_desc_en,
            detail_desc_ca = @detail_desc_ca,
            detail_desc_es = @detail_desc_es,
            detail_desc_en = @detail_desc_en,
            sort_order = @sort_order,
            updated_at = datetime('now')
        WHERE id = @id
    `),

    deleteProject: db.prepare(`
        DELETE FROM projects WHERE id = ?
    `),

    insertImage: db.prepare(`
        INSERT INTO project_images (project_id, image_path, caption_ca, caption_es, caption_en, sort_order)
        VALUES (@project_id, @image_path, @caption_ca, @caption_es, @caption_en, @sort_order)
    `),

    deleteProjectImages: db.prepare(`
        DELETE FROM project_images WHERE project_id = ?
    `),

    deleteImage: db.prepare(`
        DELETE FROM project_images WHERE id = ?
    `),

    getMaxSortOrder: db.prepare(`
        SELECT COALESCE(MAX(sort_order), 0) as max_order FROM projects
    `)
};

// ── Helper: convert DB row to API JSON format ──────────

function rowToProject(row) {
    return {
        id: row.id,
        category: row.category,
        thumbnail: row.thumbnail,
        title: row.title,
        subtitle: {
            ca: row.subtitle_ca,
            es: row.subtitle_es,
            en: row.subtitle_en
        },
        instagram: row.instagram || '',
        shortDescription: {
            ca: row.short_desc_ca,
            es: row.short_desc_es,
            en: row.short_desc_en
        },
        detail: {
            description: {
                ca: row.detail_desc_ca,
                es: row.detail_desc_es,
                en: row.detail_desc_en
            },
            images: []
        },
        sortOrder: row.sort_order,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

function imageRowToJson(row) {
    return {
        id: row.id,
        src: row.image_path,
        caption: {
            ca: row.caption_ca,
            es: row.caption_es,
            en: row.caption_en
        },
        sortOrder: row.sort_order
    };
}

// ── Public API ─────────────────────────────────────────

function getAllProjects() {
    const rows = stmts.getAllProjects.all();
    return rows.map(row => {
        const project = rowToProject(row);
        const images = stmts.getProjectImages.all(row.id);
        project.detail.images = images.map(imageRowToJson);
        return project;
    });
}

function getProjectById(id) {
    const row = stmts.getProjectById.get(id);
    if (!row) return null;
    const project = rowToProject(row);
    const images = stmts.getProjectImages.all(id);
    project.detail.images = images.map(imageRowToJson);
    return project;
}

function createProject(data) {
    const maxOrder = stmts.getMaxSortOrder.get().max_order;
    const params = {
        id: data.id || slugify(data.title || 'project'),
        category: normalizeCategory(data.category),
        thumbnail: data.thumbnail || '',
        title: data.title || '',
        subtitle_ca: data.subtitle_ca || '',
        subtitle_es: data.subtitle_es || '',
        subtitle_en: data.subtitle_en || '',
        instagram: normalizeInstagram(data.instagram),
        short_desc_ca: data.short_desc_ca || '',
        short_desc_es: data.short_desc_es || '',
        short_desc_en: data.short_desc_en || '',
        detail_desc_ca: data.detail_desc_ca || '',
        detail_desc_es: data.detail_desc_es || '',
        detail_desc_en: data.detail_desc_en || '',
        sort_order: data.sort_order ?? maxOrder + 1
    };
    stmts.insertProject.run(params);
    return getProjectById(params.id);
}

function updateProject(id, data) {
    const existing = stmts.getProjectById.get(id);
    if (!existing) return null;

    const params = {
        id: id,
        category: normalizeCategory(data.category ?? existing.category),
        thumbnail: data.thumbnail ?? existing.thumbnail,
        title: data.title ?? existing.title,
        subtitle_ca: data.subtitle_ca ?? existing.subtitle_ca,
        subtitle_es: data.subtitle_es ?? existing.subtitle_es,
        subtitle_en: data.subtitle_en ?? existing.subtitle_en,
        instagram: data.instagram === undefined ? existing.instagram : normalizeInstagram(data.instagram),
        short_desc_ca: data.short_desc_ca ?? existing.short_desc_ca,
        short_desc_es: data.short_desc_es ?? existing.short_desc_es,
        short_desc_en: data.short_desc_en ?? existing.short_desc_en,
        detail_desc_ca: data.detail_desc_ca ?? existing.detail_desc_ca,
        detail_desc_es: data.detail_desc_es ?? existing.detail_desc_es,
        detail_desc_en: data.detail_desc_en ?? existing.detail_desc_en,
        sort_order: data.sort_order ?? existing.sort_order
    };
    stmts.updateProject.run(params);
    return getProjectById(id);
}

function deleteProject(id) {
    const existing = stmts.getProjectById.get(id);
    if (!existing) return false;
    stmts.deleteProject.run(id);
    return true;
}

function addProjectImage(projectId, imagePath, captions = {}, sortOrder = 0) {
    stmts.insertImage.run({
        project_id: projectId,
        image_path: imagePath,
        caption_ca: captions.ca || '',
        caption_es: captions.es || '',
        caption_en: captions.en || '',
        sort_order: sortOrder
    });
    return getProjectById(projectId);
}

function deleteProjectImage(imageId) {
    stmts.deleteImage.run(imageId);
}

function replaceProjectImages(projectId, images) {
    const replaceTransaction = db.transaction((projectId, images) => {
        stmts.deleteProjectImages.run(projectId);
        images.forEach((img, index) => {
            stmts.insertImage.run({
                project_id: projectId,
                image_path: img.src || img.image_path || '',
                caption_ca: img.caption_ca || (img.caption && img.caption.ca) || '',
                caption_es: img.caption_es || (img.caption && img.caption.es) || '',
                caption_en: img.caption_en || (img.caption && img.caption.en) || '',
                sort_order: img.sort_order ?? index
            });
        });
    });
    replaceTransaction(projectId, images);
    return getProjectById(projectId);
}

// ── Seed from existing JSON if DB is empty ─────────────

function seedFromJson(jsonPath) {
    const count = db.prepare('SELECT COUNT(*) as count FROM projects').get().count;
    if (count > 0) return; // Already has data

    if (!fs.existsSync(jsonPath)) return;

    try {
        const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
        const insertTransaction = db.transaction((projects) => {
            projects.forEach((p, index) => {
                stmts.insertProject.run({
                    id: p.id,
                    category: normalizeCategory(p.category),
                    thumbnail: p.thumbnail || '',
                    title: p.title || '',
                    subtitle_ca: p.subtitle?.ca || '',
                    subtitle_es: p.subtitle?.es || '',
                    subtitle_en: p.subtitle?.en || '',
                    instagram: normalizeInstagram(p.instagram),
                    short_desc_ca: p.shortDescription?.ca || '',
                    short_desc_es: p.shortDescription?.es || '',
                    short_desc_en: p.shortDescription?.en || '',
                    detail_desc_ca: p.detail?.description?.ca || '',
                    detail_desc_es: p.detail?.description?.es || '',
                    detail_desc_en: p.detail?.description?.en || '',
                    sort_order: index
                });

                if (p.detail?.images) {
                    p.detail.images.forEach((img, imgIndex) => {
                        const src = typeof img === 'string' ? img : img.src;
                        stmts.insertImage.run({
                            project_id: p.id,
                            image_path: src || '',
                            caption_ca: img.caption?.ca || '',
                            caption_es: img.caption?.es || '',
                            caption_en: img.caption?.en || '',
                            sort_order: imgIndex
                        });
                    });
                }
            });
        });
        insertTransaction(data);
        console.log(`Seeded ${data.length} projects from JSON`);
    } catch (err) {
        console.error('Error seeding from JSON:', err);
    }
}

// ── Gallery ────────────────────────────────────────────

function galleryRowToJson(row) {
    return {
        id: row.id,
        src: row.image_path,
        size: row.size,
        caption: { ca: row.caption_ca, es: row.caption_es, en: row.caption_en },
        sortOrder: row.sort_order
    };
}

function getGallery() {
    return db.prepare('SELECT * FROM gallery_items ORDER BY sort_order ASC, id ASC').all().map(galleryRowToJson);
}

const replaceGalleryTransaction = db.transaction(items => {
    db.prepare('DELETE FROM gallery_items').run();
    const insert = db.prepare(`
        INSERT INTO gallery_items (image_path, size, caption_ca, caption_es, caption_en, sort_order)
        VALUES (@src, @size, @caption_ca, @caption_es, @caption_en, @sort_order)
    `);
    items.forEach((item, index) => insert.run({ ...item, sort_order: index }));
});

function replaceGallery(items) {
    replaceGalleryTransaction(items);
    return getGallery();
}

// ── Bulletins (one image per month) ────────────────────

function getBulletins() {
    return Object.fromEntries(db.prepare('SELECT month, image_path FROM bulletins ORDER BY month').all()
        .map(row => [row.month, row.image_path]));
}

function setBulletin(month, imagePath) {
    db.prepare(`
        INSERT INTO bulletins (month, image_path) VALUES (?, ?)
        ON CONFLICT(month) DO UPDATE SET image_path = excluded.image_path, updated_at = datetime('now')
    `).run(month, imagePath);
    return getBulletins();
}

function deleteBulletin(month) {
    db.prepare('DELETE FROM bulletins WHERE month = ?').run(month);
    return getBulletins();
}

// ── Materials (folder tree) ────────────────────────────

function materialRowToJson(row) {
    return {
        id: row.id,
        parentId: row.parent_id,
        type: row.type,
        name: { ca: row.name_ca, es: row.name_es, en: row.name_en },
        src: row.file_path,
        size: row.file_size,
        ext: row.file_ext,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

function getMaterials() {
    return db.prepare('SELECT * FROM material_nodes ORDER BY id ASC').all().map(materialRowToJson);
}

function getMaterialNode(id) {
    const row = db.prepare('SELECT * FROM material_nodes WHERE id = ?').get(id);
    return row ? materialRowToJson(row) : null;
}

function getMaterialDepth(id) {
    let depth = 0;
    let current = id;
    while (current !== null && current !== undefined) {
        const row = db.prepare('SELECT parent_id FROM material_nodes WHERE id = ?').get(current);
        if (!row) break;
        depth += 1;
        current = row.parent_id;
    }
    return depth;
}

function createMaterialNode({ parentId, type, names, filePath = '', fileSize = 0, ext = '' }) {
    const result = db.prepare(`
        INSERT INTO material_nodes (parent_id, type, name_ca, name_es, name_en, file_path, file_size, file_ext)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(parentId, type, names.ca, names.es, names.en, filePath, fileSize, ext);
    return getMaterialNode(result.lastInsertRowid);
}

function renameMaterialNode(id, names) {
    const result = db.prepare(`
        UPDATE material_nodes SET name_ca = ?, name_es = ?, name_en = ?, updated_at = datetime('now')
        WHERE id = ?
    `).run(names.ca, names.es, names.en, id);
    return result.changes ? getMaterialNode(id) : null;
}

// Returns the stored file paths of the removed subtree, or null when the node does not exist.
function deleteMaterialNode(id) {
    if (!getMaterialNode(id)) return null;
    const files = db.prepare(`
        WITH RECURSIVE subtree(id) AS (
            SELECT id FROM material_nodes WHERE id = ?
            UNION ALL
            SELECT m.id FROM material_nodes m JOIN subtree s ON m.parent_id = s.id
        )
        SELECT file_path FROM material_nodes WHERE type = 'file' AND id IN (SELECT id FROM subtree)
    `).all(id).map(row => row.file_path);
    db.prepare('DELETE FROM material_nodes WHERE id = ?').run(id);
    return files;
}

// ── Utility ────────────────────────────────────────────

function slugify(text) {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

function close() {
    db.close();
}

module.exports = {
    getAllProjects,
    getProjectById,
    createProject,
    updateProject,
    deleteProject,
    addProjectImage,
    deleteProjectImage,
    replaceProjectImages,
    getGallery,
    replaceGallery,
    getBulletins,
    setBulletin,
    deleteBulletin,
    getMaterials,
    getMaterialNode,
    getMaterialDepth,
    createMaterialNode,
    renameMaterialNode,
    deleteMaterialNode,
    seedFromJson,
    close
};
