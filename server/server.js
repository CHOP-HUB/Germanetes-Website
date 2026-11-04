const express = require('express');
const cors = require('cors');
const { randomBytes, timingSafeEqual, createPublicKey, verify } = require('crypto');
const multer = require('multer');
const ical = require('node-ical');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const ADMIN_HOST = (process.env.ADMIN_HOST || '').toLowerCase();
const ADMIN_USER = process.env.ADMIN_USER || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

// Cloudflare Access: when set, editor requests must carry a valid Access token and no password is asked.
const CF_ACCESS_TEAM = (process.env.CF_ACCESS_TEAM || '').trim();
const CF_ACCESS_AUD = (process.env.CF_ACCESS_AUD || '').trim();
const USE_CF_ACCESS = Boolean(CF_ACCESS_TEAM && CF_ACCESS_AUD);

if (process.env.NODE_ENV === 'production' && (!ADMIN_HOST || (!USE_CF_ACCESS && (!ADMIN_USER || !ADMIN_PASSWORD)))) {
    throw new Error('ADMIN_HOST and either CF_ACCESS_TEAM + CF_ACCESS_AUD or ADMIN_USER + ADMIN_PASSWORD must be configured in production.');
}

// Root of the website (one level up from server/)
const SITE_ROOT = path.join(__dirname, '..');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR || path.join(DATA_DIR, 'uploads'));
const GOOGLE_CALENDAR_ICS_URL = process.env.GOOGLE_CALENDAR_ICS_URL || '';
const CALENDAR_CACHE_MS = 5 * 60 * 1000;
const CALENDAR_MAX_BYTES = 2 * 1024 * 1024;
let calendarCache = { fetchedAt: 0, events: null };

// Ensure uploads directory is existing
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// ── Middleware ──────────────────────────────────────────

app.use(express.json());

const allowedOrigins = new Set(
    (process.env.CORS_ORIGINS || '')
        .split(',')
        .map(origin => origin.trim())
        .filter(Boolean)
);

app.use(cors({
    credentials: true,
    origin(origin, callback) {
        if (!origin) return callback(null, false);
        let isLocalDevelopment = false;
        try {
            const hostname = new URL(origin).hostname;
            isLocalDevelopment = ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
        } catch {}
        const allowDevelopmentOrigin = process.env.NODE_ENV !== 'production' && isLocalDevelopment;
        callback(null, allowedOrigins.has(origin) || allowDevelopmentOrigin);
    }
}));

function matchesSecret(actual, expected) {
    const actualBuffer = Buffer.from(actual);
    const expectedBuffer = Buffer.from(expected);
    return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

let accessKeys = { fetchedAt: 0, keys: [] };

async function getAccessKeys(force) {
    if (!force && accessKeys.keys.length && Date.now() - accessKeys.fetchedAt < 60 * 60 * 1000) return accessKeys.keys;
    const response = await fetch(`https://${CF_ACCESS_TEAM}.cloudflareaccess.com/cdn-cgi/access/certs`);
    if (!response.ok) throw new Error(`Access certs returned ${response.status}`);
    const { keys } = await response.json();
    accessKeys = { fetchedAt: Date.now(), keys };
    return keys;
}

async function verifyAccessToken(token) {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (header.alg !== 'RS256') return false;

    const findKey = keys => keys.find(key => key.kid === header.kid);
    let jwk = findKey(await getAccessKeys(false));
    if (!jwk) jwk = findKey(await getAccessKeys(true));
    if (!jwk) return false;

    const valid = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`),
        createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
    const audiences = [].concat(claims.aud || []);
    return valid
        && audiences.includes(CF_ACCESS_AUD)
        && claims.iss === `https://${CF_ACCESS_TEAM}.cloudflareaccess.com`
        && typeof claims.exp === 'number' && claims.exp * 1000 > Date.now();
}

async function requireAccessLogin(req, res, next) {
    try {
        const token = req.get('cf-access-jwt-assertion') || '';
        if (token && await verifyAccessToken(token)) return next();
    } catch (error) {
        console.error('Access token check failed:', error.message);
    }
    res.status(401).send('Authentication required');
}

function requireAdminAuth(req, res, next) {
    if (USE_CF_ACCESS) return requireAccessLogin(req, res, next);
    if (!ADMIN_USER || !ADMIN_PASSWORD) {
        if (process.env.NODE_ENV !== 'production') return next();
        return res.status(503).json({ error: 'CMS credentials are not configured' });
    }

    const [scheme, encodedCredentials] = (req.get('authorization') || '').split(/\s+/, 2);
    if (scheme !== 'Basic' || !encodedCredentials) {
        res.set('WWW-Authenticate', 'Basic realm="Germanetes CMS", charset="UTF-8"');
        return res.status(401).send('Authentication required');
    }

    let credentials;
    try {
        credentials = Buffer.from(encodedCredentials, 'base64').toString('utf8');
    } catch {
        credentials = '';
    }
    const separator = credentials.indexOf(':');
    const user = separator < 0 ? '' : credentials.slice(0, separator);
    const password = separator < 0 ? '' : credentials.slice(separator + 1);
    if (!matchesSecret(user, ADMIN_USER) || !matchesSecret(password, ADMIN_PASSWORD)) {
        res.set('WWW-Authenticate', 'Basic realm="Germanetes CMS", charset="UTF-8"');
        return res.status(401).send('Authentication required');
    }

    next();
}

function requireAdminHost(req, res, next) {
    if (!ADMIN_HOST) {
        if (process.env.NODE_ENV !== 'production') return next();
        return res.status(503).send('Admin hostname is not configured');
    }
    if (req.hostname.toLowerCase() !== ADMIN_HOST) {
        return res.status(404).send('Not found');
    }
    next();
}

app.use('/admin', requireAdminHost, requireAdminAuth);

// On the dedicated admin hostname the editor is the front page.
app.get('/', (req, res, next) => {
    if (!ADMIN_HOST || req.hostname.toLowerCase() !== ADMIN_HOST) return next();
    requireAdminAuth(req, res, () => res.sendFile(path.join(SITE_ROOT, 'admin', 'index.html')));
});

// Serve the static website
const MATERIALS_DIR = path.join(UPLOADS_DIR, 'materials');
fs.mkdirSync(MATERIALS_DIR, { recursive: true });

// Server source and private resources must not be reachable through the static root.
app.use(['/server', '/Germanetes_Resources'], (req, res) => res.status(404).send('Not found'));

// Uploaded materials are untrusted: stop type sniffing and force download unless it is a PDF or image.
app.use('/uploads/materials', express.static(MATERIALS_DIR, {
    index: false,
    setHeaders(res, filePath) {
        res.set('X-Content-Type-Options', 'nosniff');
        if (!/\.(pdf|jpe?g|png|gif|webp)$/i.test(filePath)) res.set('Content-Disposition', 'attachment');
    }
}));
app.use('/assets/images/projects', express.static(UPLOADS_DIR, { index: false }));
app.use('/uploads', express.static(UPLOADS_DIR, { index: false }));
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

function calendarDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
    const date = new Date(`${value}T00:00:00.000Z`);
    return date.toISOString().slice(0, 10) === value ? date : null;
}

function calendarDayKey(date, timeZone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

function googleCalendarUrl() {
    let url;
    try {
        url = new URL(GOOGLE_CALENDAR_ICS_URL);
    } catch {
        throw new Error('Google Calendar feed URL is invalid.');
    }
    if (url.protocol !== 'https:' || url.hostname !== 'calendar.google.com' ||
        !url.pathname.startsWith('/calendar/ical/') || url.username || url.password) {
        throw new Error('Use the HTTPS iCal URL from Google Calendar.');
    }
    return url;
}

async function getCalendarFeed() {
    if (calendarCache.events && Date.now() - calendarCache.fetchedAt < CALENDAR_CACHE_MS) {
        return { events: calendarCache.events, stale: false };
    }

    const url = googleCalendarUrl();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
        const response = await fetch(url, {
            headers: { accept: 'text/calendar, text/plain;q=0.9' },
            redirect: 'error',
            signal: controller.signal
        });
        if (!response.ok) throw new Error(`Google Calendar returned ${response.status}`);
        const contentLength = Number(response.headers.get('content-length') || 0);
        if (contentLength > CALENDAR_MAX_BYTES) throw new Error('Calendar feed exceeds the size limit.');

        const text = await response.text();
        if (Buffer.byteLength(text, 'utf8') > CALENDAR_MAX_BYTES) {
            throw new Error('Calendar feed exceeds the size limit.');
        }
        const parsed = await ical.async.parseICS(text);
        calendarCache = {
            fetchedAt: Date.now(),
            events: Object.values(parsed).filter(event => event.type === 'VEVENT' && event.start instanceof Date)
        };
        return { events: calendarCache.events, stale: false };
    } finally {
        clearTimeout(timeout);
    }
}

function calendarEventsInRange(events, startDate, endDate) {
    const rangeStart = new Date(startDate.getTime() - 86400000);
    const rangeEnd = new Date(endDate.getTime() + 86400000);
    const output = [];

    for (const event of events) {
        const occurrences = event.rrule
            ? ical.expandRecurringEvent(event, { from: rangeStart, to: rangeEnd, expandOngoing: true })
            : [event];

        for (const occurrence of occurrences) {
            if (!(occurrence.start instanceof Date)) continue;
            const timeZone = occurrence.start.tz || event.start.tz || 'Europe/Madrid';
            const date = calendarDayKey(occurrence.start, timeZone);
            if (date < startDate.toISOString().slice(0, 10) || date >= endDate.toISOString().slice(0, 10)) continue;

            const rawCategories = occurrence.categories || event.categories;
            const category = (Array.isArray(rawCategories) ? rawCategories : String(rawCategories || '').split(/[;,]/))
                .map(value => String(value).trim())
                .find(Boolean) || '';
            output.push({
                id: `${event.uid || event.summary || 'event'}-${occurrence.start.toISOString()}`,
                date,
                start: occurrence.start.toISOString(),
                end: occurrence.end instanceof Date ? occurrence.end.toISOString() : occurrence.start.toISOString(),
                timeZone,
                allDay: Boolean(occurrence.start.dateOnly || event.datetype === 'date'),
                title: String(occurrence.summary || event.summary || 'Event'),
                description: String(occurrence.description || event.description || ''),
                location: String(occurrence.location || event.location || ''),
                category
            });
        }
    }

    return output.sort((first, second) => first.start.localeCompare(second.start));
}

app.get('/api/calendar/events', async (req, res) => {
    if (!GOOGLE_CALENDAR_ICS_URL) {
        return res.json({ configured: false, events: [] });
    }

    const startDate = calendarDate(req.query.start);
    const endDate = calendarDate(req.query.end);
    if (!startDate || !endDate || endDate <= startDate || endDate - startDate > 62 * 86400000) {
        return res.status(400).json({ error: 'Provide a valid date range of no more than 62 days.' });
    }

    try {
        const feed = await getCalendarFeed();
        res.json({ configured: true, stale: feed.stale, events: calendarEventsInRange(feed.events, startDate, endDate) });
    } catch (error) {
        console.error('Unable to refresh the Google Calendar feed:', error.message);
        if (calendarCache.events) {
            return res.json({ configured: true, stale: true, events: calendarEventsInRange(calendarCache.events, startDate, endDate) });
        }
        res.status(502).json({ error: 'Google Calendar feed is unavailable.' });
    }
});

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
app.post('/api/projects', requireAdminHost, requireAdminAuth, (req, res) => {
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
app.put('/api/projects/:id', requireAdminHost, requireAdminAuth, (req, res) => {
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
app.delete('/api/projects/:id', requireAdminHost, requireAdminAuth, (req, res) => {
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
app.post('/api/upload', requireAdminHost, requireAdminAuth, upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No image file provided' });
    }
    res.json({ path: '/uploads/' + req.file.filename });
});

// PUT /api/projects/:id/images — replace all images for a project
app.put('/api/projects/:id/images', requireAdminHost, requireAdminAuth, (req, res) => {
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
app.post('/api/projects/:id/images', requireAdminHost, requireAdminAuth, upload.single('image'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image file provided' });
        }
        const relativePath = '/uploads/' + req.file.filename;
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

// ── Gallery ────────────────────────────────────────────────────────

const adminOnly = [requireAdminHost, requireAdminAuth];

function cleanText(value, max = 200) {
    return String(value ?? '').trim().slice(0, max);
}

function isSiteImagePath(value) {
    return typeof value === 'string' && /^\/(uploads|assets\/images)\/[^?#]+$/.test(value) && !value.includes('..');
}

function namesFrom(body) {
    const names = { ca: cleanText(body.name_ca), es: cleanText(body.name_es), en: cleanText(body.name_en) };
    const fallback = names.ca || names.es || names.en;
    return fallback ? { ca: names.ca || fallback, es: names.es || fallback, en: names.en || fallback } : null;
}

app.get('/api/gallery', (req, res) => {
    try {
        res.json(db.getGallery());
    } catch (err) {
        console.error('Error fetching gallery:', err);
        res.status(500).json({ error: 'Failed to fetch gallery' });
    }
});

// PUT /api/gallery — replace the whole gallery (order, sizes, captions)
app.put('/api/gallery', ...adminOnly, (req, res) => {
    const incoming = req.body?.items;
    if (!Array.isArray(incoming) || incoming.length > 500) {
        return res.status(400).json({ error: 'Expected a list of at most 500 items' });
    }
    const items = [];
    for (const item of incoming) {
        const size = Number(item?.size);
        if (!isSiteImagePath(item?.src) || ![1, 2, 3].includes(size)) {
            return res.status(400).json({ error: 'Each item needs a site image path and a size of 1, 2 or 3' });
        }
        items.push({
            src: item.src,
            size,
            caption_ca: cleanText(item.caption?.ca, 300),
            caption_es: cleanText(item.caption?.es, 300),
            caption_en: cleanText(item.caption?.en, 300)
        });
    }
    try {
        res.json(db.replaceGallery(items));
    } catch (err) {
        console.error('Error saving gallery:', err);
        res.status(500).json({ error: 'Failed to save gallery' });
    }
});

// ── Server stats (footer) ───────────────────────────────────────────

// source ('solar' | 'grid') and powerWatts stay null until the Pi has a way to measure them.
app.get('/api/server-stats', (req, res) => {
    res.set('Cache-Control', 'public, max-age=30');
    res.json({ uptimeSeconds: Math.floor(os.uptime()), source: null, powerWatts: null });
});

// ── Bulletins ────────────────────────────────────────────────────────

const BULLETIN_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

app.get('/api/bulletins', (req, res) => {
    try {
        res.json(db.getBulletins());
    } catch (err) {
        console.error('Error fetching bulletins:', err);
        res.status(500).json({ error: 'Failed to fetch bulletins' });
    }
});

app.put('/api/bulletins/:month', ...adminOnly, (req, res) => {
    if (!BULLETIN_MONTH.test(req.params.month) || !isSiteImagePath(req.body?.src)) {
        return res.status(400).json({ error: 'Expected a month (YYYY-MM) and a site image path' });
    }
    try {
        res.json(db.setBulletin(req.params.month, req.body.src));
    } catch (err) {
        console.error('Error saving bulletin:', err);
        res.status(500).json({ error: 'Failed to save bulletin' });
    }
});

app.delete('/api/bulletins/:month', ...adminOnly, (req, res) => {
    if (!BULLETIN_MONTH.test(req.params.month)) return res.status(400).json({ error: 'Invalid month' });
    try {
        res.json(db.deleteBulletin(req.params.month));
    } catch (err) {
        console.error('Error deleting bulletin:', err);
        res.status(500).json({ error: 'Failed to delete bulletin' });
    }
});

// ── Materials ────────────────────────────────────────────────────────

const MATERIAL_EXTENSIONS = new Set([
    '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.doc', '.docx', '.xls', '.xlsx',
    '.ppt', '.pptx', '.odt', '.ods', '.odp', '.txt', '.csv', '.zip'
]);
const MAX_MATERIAL_DEPTH = 6;

const materialUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, MATERIALS_DIR),
        filename: (req, file, cb) => cb(null, `${randomBytes(12).toString('hex')}${path.extname(file.originalname).toLowerCase()}`)
    }),
    limits: { fileSize: 25 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
        if (MATERIAL_EXTENSIONS.has(path.extname(file.originalname).toLowerCase())) cb(null, true);
        else cb(new Error('This file type is not allowed'));
    }
}).single('file');

function receiveMaterialFile(req, res, next) {
    materialUpload(req, res, err => err ? res.status(400).json({ error: err.message }) : next());
}

function removeStoredMaterialFiles(filePaths) {
    for (const filePath of filePaths) {
        fs.unlink(path.join(MATERIALS_DIR, path.basename(filePath)), error => {
            if (error && error.code !== 'ENOENT') console.error('Could not remove material file:', error.message);
        });
    }
}

// Resolves a submitted parent id to null (top level) or an existing folder below the depth limit.
function resolveParentFolder(value) {
    if (value === undefined || value === null || value === '' || value === 'null') return { parentId: null };
    const parentId = Number.parseInt(value, 10);
    const parent = Number.isInteger(parentId) ? db.getMaterialNode(parentId) : null;
    if (!parent || parent.type !== 'folder') return { error: 'The parent folder does not exist' };
    if (db.getMaterialDepth(parentId) >= MAX_MATERIAL_DEPTH) return { error: 'Folders are nested too deeply' };
    return { parentId };
}

app.get('/api/materials', (req, res) => {
    try {
        res.json(db.getMaterials());
    } catch (err) {
        console.error('Error fetching materials:', err);
        res.status(500).json({ error: 'Failed to fetch materials' });
    }
});

app.post('/api/materials/folders', ...adminOnly, (req, res) => {
    const names = namesFrom(req.body || {});
    const parent = resolveParentFolder(req.body?.parent_id);
    if (!names) return res.status(400).json({ error: 'A folder name is required' });
    if (parent.error) return res.status(400).json({ error: parent.error });
    try {
        res.status(201).json(db.createMaterialNode({ parentId: parent.parentId, type: 'folder', names }));
    } catch (err) {
        console.error('Error creating folder:', err);
        res.status(500).json({ error: 'Failed to create folder' });
    }
});

app.post('/api/materials/files', ...adminOnly, receiveMaterialFile, (req, res) => {
    const discardUpload = () => req.file && fs.unlink(req.file.path, () => {});
    const names = namesFrom(req.body || {});
    const parent = resolveParentFolder(req.body?.parent_id);
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    if (!names || parent.error) {
        discardUpload();
        return res.status(400).json({ error: parent.error || 'A file name is required' });
    }
    try {
        res.status(201).json(db.createMaterialNode({
            parentId: parent.parentId,
            type: 'file',
            names,
            filePath: `/uploads/materials/${req.file.filename}`,
            fileSize: req.file.size,
            ext: path.extname(req.file.filename).slice(1)
        }));
    } catch (err) {
        discardUpload();
        console.error('Error saving material file:', err);
        res.status(500).json({ error: 'Failed to save file' });
    }
});

app.put('/api/materials/:id', ...adminOnly, (req, res) => {
    const names = namesFrom(req.body || {});
    if (!names) return res.status(400).json({ error: 'A name is required' });
    try {
        const node = db.renameMaterialNode(Number.parseInt(req.params.id, 10), names);
        if (!node) return res.status(404).json({ error: 'Not found' });
        res.json(node);
    } catch (err) {
        console.error('Error renaming material:', err);
        res.status(500).json({ error: 'Failed to rename' });
    }
});

app.delete('/api/materials/:id', ...adminOnly, (req, res) => {
    try {
        const removedFiles = db.deleteMaterialNode(Number.parseInt(req.params.id, 10));
        if (removedFiles === null) return res.status(404).json({ error: 'Not found' });
        removeStoredMaterialFiles(removedFiles);
        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting material:', err);
        res.status(500).json({ error: 'Failed to delete' });
    }
});

// ── Seed data from existing JSON on first run ──────────

const jsonPath = path.join(SITE_ROOT, 'data', 'projects.json');
db.seedFromJson(jsonPath);

// ── Start Server ───────────────────────────────────────

app.listen(PORT, HOST, () => {
    console.log(`Germanetes CMS listening on ${HOST}:${PORT}`);
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
