# Deployment and LAN hosting

## Topology

Run both processes on the same trusted host:

- Next.js frontend: `127.0.0.1:3001` (internal);
- Express HTTP/WebSocket server: `0.0.0.0:3000` (browser/LAN entry point);
- SQLite: persistent local disk, not a network share.

Only port `3000` needs LAN exposure. The browser uses relative API/WebSocket URLs and must not call another device's `localhost`.

## Host installation

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin tkd
sudo mkdir -p /opt/tkd-scoring /var/lib/tkd-scoring /var/backups/tkd-scoring
sudo chown -R tkd:tkd /opt/tkd-scoring /var/lib/tkd-scoring /var/backups/tkd-scoring
```

Copy the repository to `/opt/tkd-scoring`, then as the service user:

```bash
cd /opt/tkd-scoring
npm ci
npm run typecheck
npm run lint
npm test
npm run validate:migrations
npm run build
```

`better-sqlite3` is native. Use a supported Node 22 runtime and install the platform's compiler/prebuilt-binary requirements if `npm ci` cannot build it.

## Environment

Do not rely on a `.env` file being loaded automatically; the supplied start scripts expect process environment variables. A service manager is recommended.

```dotenv
NODE_ENV=production
PORT=3000
WEB_INTERNAL_URL=http://127.0.0.1:3001
APP_PUBLIC_URL=http://192.168.1.10:3000
TKD_DATABASE_PATH=/var/lib/tkd-scoring/tournament.db
TKD_MODE=LOCAL
NEXT_PUBLIC_TKD_MODE=LOCAL
SEED_DEVELOPMENT=false
ALLOW_DEMO_LOGIN=false
PAIRING_TOKEN_TTL_SECONDS=300
PRESENCE_EXPIRY_SECONDS=15
```

Set `APP_PUBLIC_URL` to the host's actual LAN address before generating pairing QR codes. Use absolute database paths in production.

## systemd example

Create `/etc/systemd/system/tkd-scoring.service`:

```ini
[Unit]
Description=TKD Scoring by ADAM AGHZAF
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=tkd
Group=tkd
WorkingDirectory=/opt/tkd-scoring
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=WEB_INTERNAL_URL=http://127.0.0.1:3001
Environment=APP_PUBLIC_URL=http://192.168.1.10:3000
Environment=TKD_DATABASE_PATH=/var/lib/tkd-scoring/tournament.db
Environment=TKD_MODE=LOCAL
Environment=NEXT_PUBLIC_TKD_MODE=LOCAL
Environment=SEED_DEVELOPMENT=false
Environment=ALLOW_DEMO_LOGIN=false
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=3
TimeoutStopSec=15
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/tkd-scoring

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now tkd-scoring
sudo systemctl status tkd-scoring
journalctl -u tkd-scoring -n 100 --no-pager
curl http://127.0.0.1:3000/api/v1/health
```

If Node/npm are installed through a version manager, use the absolute `npm` binary path visible to the `tkd` user. `ProtectHome=true` may require installing the application outside `/home`.

## Firewall and wireless

Permit TCP 3000 only from the tournament subnet. Do not expose the local server directly to the Internet without a properly configured TLS reverse proxy and additional deployment review.

- Disable wireless client isolation on the dedicated tournament AP.
- Reserve the host IP and keep it unchanged while QR codes are in use.
- Prefer Ethernet for host and TV.
- Internet can remain disconnected; no CDN assets are required by the production UI.

Example with `ufw`:

```bash
sudo ufw allow from 192.168.1.0/24 to any port 3000 proto tcp
sudo ufw deny 3001/tcp
```

Adapt the subnet and firewall to your environment.

## HTTPS reverse proxy

For an Internet-accessible authenticated deployment, terminate TLS at a reverse proxy and forward both HTTP and WebSocket upgrades to port 3000. Preserve `Host`, `X-Forwarded-Proto`, and `X-Forwarded-For`. The local server sets secure cookies when the forwarded protocol is HTTPS.

Do not put the Next.js internal port on the public proxy. Do not forward to one server for API and another for WebSockets unless stickiness and shared persistence are designed explicitly.

## Updates

1. Take and verify an online backup.
2. Test the new version against a copy of the database.
3. Stop the service, install dependencies, run migration/type/test/build checks, and start.
4. Verify health, latest event IDs, and operator recovery before allowing scoring.
5. Keep the previous release and backup for rollback; never roll back code without checking schema compatibility.

## Android and PWA

The manifest/service worker supports installation and application-shell caching on Android. It does not turn Chrome/Android into the authoritative offline host. No genuine Android Node/server runtime, background restrictions handling, wakelock, LAN socket lifecycle, or hardware test is included. Use a laptop or dedicated Linux host for verified offline operation.
