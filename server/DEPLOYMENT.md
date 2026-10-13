# Raspberry Pi Deployment

This site is designed to run directly on a Raspberry Pi Zero 2 W without Docker. Node.js serves the static site and CMS API; SQLite stores editable project content. Keep runtime data outside the Git checkout so code updates cannot replace it.

## Runtime layout

- Application checkout: `/opt/germanetes`
- SQLite database, uploaded images, and local backups: `/var/lib/germanetes`
- Node listens only on `127.0.0.1:3000`; Caddy terminates HTTPS and reverse-proxies requests
- The database is the runtime source of truth. `data/projects.json` is used only to seed a new, empty database.

The admin page and all CMS write/upload endpoints require HTTP Basic authentication. Public project reads remain available. The Basic-auth credentials must only travel over HTTPS; do not expose port 3000 directly.

## Fresh installation

1. Install Raspberry Pi OS Lite (64-bit), update it, and install a supported Node.js LTS release, Git, Caddy, and the native build tools required by `better-sqlite3` if no prebuilt package is available. The Zero 2 W has limited memory; avoid Docker and run `npm ci` only during installation or dependency updates.
2. Create a dedicated service account and persistent data directory:

   ```sh
   sudo useradd --system --home /var/lib/germanetes --shell /usr/sbin/nologin germanetes
   sudo install -d -o germanetes -g germanetes /var/lib/germanetes/uploads /var/lib/germanetes/backups /var/lib/germanetes/nodejs/releases
   ```

3. Clone the repository into `/opt/germanetes`. For a private repository, configure a read-only deploy key for the root account, which runs the updater. Check out the branch to deploy (default: `main`).
4. Install production dependencies outside the checkout. Package lifecycle scripts run as the unprivileged service account, and the installed version is switched atomically:

   ```sh
   sudo bash /opt/germanetes/server/deploy/install-dependencies.sh
   ```

5. Install the systemd service and timers:

   ```sh
   sudo install -m 644 /opt/germanetes/server/deploy/germanetes.service /etc/systemd/system/
   sudo install -m 644 /opt/germanetes/server/deploy/germanetes-backup.service /etc/systemd/system/
   sudo install -m 644 /opt/germanetes/server/deploy/germanetes-backup.timer /etc/systemd/system/
   sudo install -m 644 /opt/germanetes/server/deploy/germanetes-update.service /etc/systemd/system/
   sudo install -m 644 /opt/germanetes/server/deploy/germanetes-update.timer /etc/systemd/system/
   sudo systemctl daemon-reload
   ```

6. Create `/etc/germanetes/germanetes.env` (mode `0600`) with a unique `ADMIN_USER` and strong `ADMIN_PASSWORD`. Set `GOOGLE_CALENDAR_ICS_URL` to the iCal address for a Google Calendar intentionally made public; all its event titles, descriptions, times, and locations are shown to website visitors. Do not use a private URL or a calendar containing sensitive information. Optionally set `UPDATE_BRANCH` and `CORS_ORIGINS`; same-origin requests need no CORS entry. Never put credentials in the Git checkout.
7. Configure Caddy to reverse-proxy the domain to the local Node service. Replace `{$SITE_DOMAIN}` in the example with the real domain, make sure DNS points to the Pi, and forward only ports 80 and 443 from the router:

   ```sh
   sudo cp /opt/germanetes/server/deploy/Caddyfile.example /etc/caddy/Caddyfile
   sudoedit /etc/caddy/Caddyfile
   sudo systemctl enable --now caddy
   sudo systemctl reload caddy
   ```

8. Start the application and scheduled jobs only after credentials and the proxy config are ready:

   ```sh
   sudo systemctl enable --now germanetes.service germanetes-backup.timer germanetes-update.timer
   ```

The update timer checks Git every 15 minutes. It deploys fast-forward updates only, refuses a dirty or diverged checkout, installs dependencies only when the server lockfiles change, and restarts the service after an update. Dependency versions live in `/var/lib/germanetes/nodejs`; the installer retains the latest two releases. The updater never resets the checkout. Check logs with `journalctl -u germanetes-update.service` and `journalctl -u germanetes.service`.

The backup timer creates a consistent SQLite backup daily and retains the latest 14 files under `/var/lib/germanetes/backups`. A second copy should be synced to another device or storage provider; backups on the same SD card do not protect against card failure.

## Moving an existing installation

Do this once before pulling a commit that removes the Git-tracked database. The commands preserve the old checkout until the persistent copy has been verified.

1. Stop the app so SQLite can close cleanly:

   ```sh
   sudo systemctl stop germanetes.service
   ```

2. Copy the database and project images to persistent storage. Set ownership for the service account:

   ```sh
   sudo install -d -o germanetes -g germanetes /var/lib/germanetes/uploads /var/lib/germanetes/backups
   sudo cp -a /opt/germanetes/server/data/projects.db* /var/lib/germanetes/
   sudo cp -a /opt/germanetes/assets/images/projects/. /var/lib/germanetes/uploads/
   sudo chown -R germanetes:germanetes /var/lib/germanetes
   ```

3. Verify the copied database before touching the checkout:

   ```sh
   sudo -u germanetes node -e "const D=require('/opt/germanetes/server/node_modules/better-sqlite3');const d=new D('/var/lib/germanetes/projects.db',{readonly:true});console.log(d.prepare('select count(*) as projects from projects').get());d.close()"
   ```

4. Only after the copied row count and images are confirmed, restore the old tracked database files in the checkout so Git sees a clean worktree and can apply their removal cleanly:

   ```sh
   cd /opt/germanetes
   sudo git -C /opt/germanetes restore --worktree --source=HEAD -- server/data/projects.db server/data/projects.db-shm server/data/projects.db-wal
   ```

   This restores only the checkout copies; the verified database under `/var/lib/germanetes` remains untouched. Inspect any other local Git changes before updating. Move or commit any untracked image files only after confirming they were copied.

5. Pull the deployment commit, install the new service files, and start the service. The new server serves existing `assets/images/projects/...` references from persistent storage first, with the checkout as fallback. New uploads are stored outside Git and served from `/uploads/...`.

If `/var/lib/germanetes/projects.db` already exists, the migration helper intentionally refuses to overwrite it. Back up that directory before any manual repair.

## Recovery

To restore a backup, stop the service, preserve the current database, copy the chosen backup to `/var/lib/germanetes/projects.db`, set ownership to `germanetes`, then start the service. Keep image backups alongside the database; a database backup alone does not contain image files.
