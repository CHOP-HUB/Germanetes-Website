# Raspberry Pi Deployment

This site is designed to run directly on a Raspberry Pi Zero 2 W without Docker. Node.js serves the static site and CMS API; SQLite stores editable project content. Keep runtime data outside the Git checkout so code updates cannot replace it.

## Runtime layout

- Application checkout: `/opt/germanetes`
- SQLite database, uploaded images, and local backups: `/var/lib/germanetes`
- Node listens only on `127.0.0.1:3000`; `cloudflared` connects outbound to Cloudflare and no router ports are forwarded
- The public site and the admin use separate hostnames routed to the same local service
- The database is the runtime source of truth. `data/projects.json` is used only to seed a new, empty database.

The admin page and all CMS write/upload endpoints require HTTP Basic authentication. Cloudflare Access adds GitHub sign-in in front of the admin hostname. Public project reads remain available on the public hostname. Keep port 3000 bound to loopback and do not forward router ports to the Pi.

## Fresh installation

1. Install Raspberry Pi OS Lite (64-bit), update it, and install a supported Node.js LTS release, Git, `cloudflared`, and the native build tools required by `better-sqlite3` if no prebuilt package is available. The Zero 2 W has limited memory; avoid Docker and run `npm ci` only during installation or dependency updates.
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

6. Create `/etc/germanetes/germanetes.env` (mode `0600`) with `ADMIN_HOST=admin.example.org`, a unique `ADMIN_USER`, and a strong `ADMIN_PASSWORD`. `ADMIN_HOST` must exactly match the dedicated Cloudflare admin hostname; the server returns 404 for admin and write requests addressed through the public hostname. Set `GOOGLE_CALENDAR_ICS_URL` to the iCal address for a Google Calendar intentionally made public; all its event titles, descriptions, times, and locations are shown to website visitors. Do not use a private URL or a calendar containing sensitive information. Leave `CORS_ORIGINS` empty for the same-origin setup below. Never put credentials in the Git checkout.
7. Configure GitHub as a Cloudflare Access identity provider:

   - In GitHub, create an OAuth App. Set its homepage to `https://<team-name>.cloudflareaccess.com` and its callback to `https://<team-name>.cloudflareaccess.com/cdn-cgi/access/callback`.
   - Add that app in Cloudflare Zero Trust under **Integrations > Identity providers > GitHub**. Keep the client secret in Cloudflare, never in this repository or the Pi's public files.
   - Create a **Self-hosted** Access application for the dedicated admin hostname (for example, `admin.example.org`) and add an **Allow** policy restricted to the garden workers' GitHub organization/team or specific identities. Access applications deny users who do not match an Allow policy.

8. In Cloudflare Zero Trust, create the tunnel and add two public hostnames, both pointing to `http://127.0.0.1:3000`:

   - `www.example.org`: public website; do not put this hostname behind the admin Access policy.
   - `admin.example.org`: admin interface; associate it with the Access application and enable **Protect with Access** on the tunnel route so `cloudflared` validates the Access token before forwarding requests.

   Create and test the Access application before publishing the admin hostname. The admin page uses its own origin for API calls, so its API requests stay on the protected admin hostname. The current app also requires its Basic Auth credentials after Cloudflare login; this is intentional defense in depth, though it means two login steps.

9. Start the application and scheduled jobs only after the Access policy, tunnel routes, and credentials are ready:

   ```sh
   sudo systemctl enable --now germanetes.service germanetes-backup.timer germanetes-update.timer
   ```

Install and enable the `cloudflared` service using the connector command provided by the Cloudflare dashboard. Store its tunnel token as a root-managed secret, not in the Git checkout. Do not open inbound ports on the router. The update timer checks Git every 15 minutes. It deploys fast-forward updates only, refuses a dirty or diverged checkout, installs dependencies only when the server lockfiles change, and restarts the service after an update. Dependency versions live in `/var/lib/germanetes/nodejs`; the installer retains the latest two releases. The updater never resets the checkout. Check logs with `journalctl -u germanetes-update.service` and `journalctl -u germanetes.service`.

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
