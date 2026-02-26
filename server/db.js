const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
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
        category TEXT NOT NULL CHECK(category IN ('ongoing', 'temporal', 'archive')),
        thumbnail TEXT DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
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
        INSERT INTO projects (id, category, thumbnail, title,
            short_desc_ca, short_desc_es, short_desc_en,
            detail_desc_ca, detail_desc_es, detail_desc_en, sort_order)
        VALUES (@id, @category, @thumbnail, @title,
            @short_desc_ca, @short_desc_es, @short_desc_en,
            @detail_desc_ca, @detail_desc_es, @detail_desc_en, @sort_order)
    `),

    updateProject: db.prepare(`
        UPDATE projects SET
            category = @category,
            thumbnail = @thumbnail,
            title = @title,
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
        category: data.category || 'ongoing',
        thumbnail: data.thumbnail || '',
        title: data.title || '',
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
        category: data.category ?? existing.category,
        thumbnail: data.thumbnail ?? existing.thumbnail,
        title: data.title ?? existing.title,
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
                    category: p.category,
                    thumbnail: p.thumbnail || '',
                    title: p.title || '',
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
    seedFromJson,
    close
};
