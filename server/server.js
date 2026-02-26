const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Root of the website (one level up from server/)
const SITE_ROOT = path.join(__dirname, '..');
const UPLOADS_DIR = path.join(SITE_ROOT, 'assets', 'images', 'projects');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// ── Middleware ──────────────────────────────────────────

app.use(cors());
app.use(express.json());

// Serve the static website
app.use(express.static(SITE_ROOT));

// ── File Upload Config ─────────────────────────────────

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const name = path.basename(file.originalname, ext)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
        const unique = Date.now() + '-' + Math.round(Math.random() * 1000);
        cb(null, `${name}-${unique}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
    fileFilter: (req, file, cb) => {
        const allowed = /\.(jpg|jpeg|png|gif|webp|svg)$/i;
        if (allowed.test(path.extname(file.originalname))) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'));
        }
    }
});

// ── API Routes ─────────────────────────────────────────

// GET /api/projects — list all projects (same shape as data/projects.json)
app.get('/api/projects', (req, res) => {
    try {
        const projects = db.getAllProjects();
        res.json(projects);
    } catch (err) {
        console.error('Error fetching projects:', err);
        res.status(500).json({ error: 'Failed to fetch projects' });
    }
});

// GET /api/projects/:id — get a single project
app.get('/api/projects/:id', (req, res) => {
    try {
        const project = db.getProjectById(req.params.id);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }
        res.json(project);
    } catch (err) {
        console.error('Error fetching project:', err);
        res.status(500).json({ error: 'Failed to fetch project' });
    }
});

// POST /api/projects — create a new project
app.post('/api/projects', (req, res) => {
    try {
        const project = db.createProject(req.body);
        res.status(201).json(project);
    } catch (err) {
        console.error('Error creating project:', err);
        if (err.message?.includes('UNIQUE constraint')) {
            return res.status(409).json({ error: 'A project with this ID already exists' });
        }
        res.status(500).json({ error: 'Failed to create project' });
    }
});

// PUT /api/projects/:id — update a project
app.put('/api/projects/:id', (req, res) => {
    try {
        const project = db.updateProject(req.params.id, req.body);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }
        res.json(project);
    } catch (err) {
        console.error('Error updating project:', err);
        res.status(500).json({ error: 'Failed to update project' });
    }
});

// DELETE /api/projects/:id — delete a project
app.delete('/api/projects/:id', (req, res) => {
    try {
        const deleted = db.deleteProject(req.params.id);
        if (!deleted) {
            return res.status(404).json({ error: 'Project not found' });
        }
        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting project:', err);
        res.status(500).json({ error: 'Failed to delete project' });
    }
});

// POST /api/upload — upload an image, return the path
app.post('/api/upload', upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No image file provided' });
    }
    // Return path relative to site root
    const relativePath = 'assets/images/projects/' + req.file.filename;
    res.json({ path: relativePath });
});

// PUT /api/projects/:id/images — replace all images for a project
app.put('/api/projects/:id/images', (req, res) => {
    try {
        const project = db.replaceProjectImages(req.params.id, req.body.images || []);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }
        res.json(project);
    } catch (err) {
        console.error('Error updating images:', err);
        res.status(500).json({ error: 'Failed to update images' });
    }
});

// POST /api/projects/:id/images — add a single image to a project
app.post('/api/projects/:id/images', upload.single('image'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image file provided' });
        }
        const relativePath = 'assets/images/projects/' + req.file.filename;
        const captions = {
            ca: req.body.caption_ca || '',
            es: req.body.caption_es || '',
            en: req.body.caption_en || ''
        };
        const sortOrder = parseInt(req.body.sort_order) || 0;
        const project = db.addProjectImage(req.params.id, relativePath, captions, sortOrder);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }
        res.json(project);
    } catch (err) {
        console.error('Error adding image:', err);
        res.status(500).json({ error: 'Failed to add image' });
    }
});

// ── Seed data from existing JSON on first run ──────────

const jsonPath = path.join(SITE_ROOT, 'data', 'projects.json');
db.seedFromJson(jsonPath);

// ── Start Server ───────────────────────────────────────

app.listen(PORT, () => {
    console.log(`Germanetes CMS running at http://localhost:${PORT}`);
    console.log(`Admin panel: http://localhost:${PORT}/admin`);
    console.log(`API: http://localhost:${PORT}/api/projects`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down...');
    db.close();
    process.exit(0);
});

process.on('SIGTERM', () => {
    db.close();
    process.exit(0);
});
