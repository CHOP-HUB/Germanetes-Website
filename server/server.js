const express = require('express');
const cors = require('cors');
const { timingSafeEqual } = require('crypto');
const multer = require('multer');
const ical = require('node-ical');
const path = require('path');
const fs = require('fs');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const ADMIN_USER = process.env.ADMIN_USER || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

if (process.env.NODE_ENV === 'production' && (!ADMIN_USER || !ADMIN_PASSWORD)) {
    throw new Error('ADMIN_USER and ADMIN_PASSWORD must be configured in production.');
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
        callback(null, allowedOrigins.has(origin) || isLocalDevelopment);
    }
}));

function matchesSecret(actual, expected) {
    const actualBuffer = Buffer.from(actual);
    const expectedBuffer = Buffer.from(expected);
    return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function requireAdminAuth(req, res, next) {
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

app.use('/admin', requireAdminAuth);

// Serve the static website
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
app.post('/api/projects', requireAdminAuth, (req, res) => {
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
app.put('/api/projects/:id', requireAdminAuth, (req, res) => {
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
app.delete('/api/projects/:id', requireAdminAuth, (req, res) => {
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
app.post('/api/upload', requireAdminAuth, upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No image file provided' });
    }
    res.json({ path: '/uploads/' + req.file.filename });
});

// PUT /api/projects/:id/images — replace all images for a project
app.put('/api/projects/:id/images', requireAdminAuth, (req, res) => {
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
app.post('/api/projects/:id/images', requireAdminAuth, upload.single('image'), (req, res) => {
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
