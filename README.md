# Germanetes Jardins d'Emma Website

The site is a vanilla HTML/CSS/JavaScript single-page website with Catalan, Spanish, and English translations. The Node.js service serves the site and project CMS; SQLite is the runtime source of truth for editable project content.

## Local development

```sh
cd server
npm ci
npm start
```

The site is available at `http://localhost:3000` and the CMS at `http://localhost:3000/admin`. The database is created in `server/data/` and seeded from `data/projects.json` only on first run. CMS edits are stored in SQLite.

## Raspberry Pi

See [server/DEPLOYMENT.md](server/DEPLOYMENT.md) for persistent storage migration, systemd service and timers, database backups, automatic fast-forward updates, and security requirements. Keep the Pi's database and uploads outside the Git checkout.

## Project layout

- `pages/`, `components/`: SPA page fragments and shared navigation/footer
- `js/`, `css/`, `lang/`: browser behavior, styles, and translations
- `admin/`: standalone project editor
- `server/`: Express API, SQLite persistence, migration/backup tools, and Pi service files
- `data/projects.json`: initial project seed data