# Deployment

Open Nutrition is **one process with one SQLite file**. Pick whichever platform you already run. The deployment options are equivalent, and the data moves between them by copying `/data`.

| Option | Best for | Effort |
|---|---|---|
| [Docker / Compose](#docker--compose) | Most homelabs, NAS (Synology, Unraid, TrueNAS), a VPS | ⭐ easiest |
| [Kubernetes](#kubernetes) | k3s / Talos / existing clusters | ⭐⭐ |
| [Proxmox](#proxmox) | Proxmox VE hosts: an LXC with no Docker, or a VM running Docker | ⭐⭐ |

**Recommendation if you're unsure:** Docker Compose, either inside a small Proxmox LXC/VM or on whatever box already runs your containers. It has the fewest moving parts, and upgrades are just `docker compose pull && docker compose up -d`.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `DATA_DIR` | `/data` (in the image) | Location of `open-nutrition.db` |
| `DATABASE_FILE` | `$DATA_DIR/open-nutrition.db` | Overrides the DB path |
| `WEB_DIR` | `/app/web` (in the image) | Built web UI; unset = API only |
| `ALLOW_REGISTRATION` | `false` | The **first** account can always be created and becomes admin. Set to `true` to let others sign up |
| `TRUST_PROXY` | `false` | Set to `true` behind a reverse proxy, so rate limiting sees real client IPs |
| `CORS_ORIGINS` | *(any)* | Comma-separated allow-list, if you host the web UI on another origin |
| `LOG_LEVEL` | `info` | `silent`, `error`, `warn`, `info` or `debug` |
| `LLM_PROVIDER` | *(unset)* | `anthropic` enables AI meal logging; see [AI_MEAL_LOGGING.md](AI_MEAL_LOGGING.md) |
| `LLM_API_KEY` | | Claude API key (`ANTHROPIC_API_KEY` also works). Server-side only. Use a dedicated key in a Console workspace with a monthly spend limit |
| `AI_MONTHLY_LIMIT` | `0` | Per-user cap on AI estimates per calendar month (`0` = unlimited) |
| `USDA_API_KEY` | *(unset)* | Optional free [api.data.gov](https://api.data.gov/signup/) key (1,000 requests/hour). Enables searching USDA packaged (branded) foods, about 430,000 grocery products, from the phone and web, and the USDA fallback for barcodes not in Open Food Facts. Results are cached on the server for a week. |
| `FOOD_DB_PATH` | `/app/foods.db` (in the image) | Bundled USDA food database (read-only). Source checkout default: `apps/mobile/assets/foods.db` |
| `TZ` | `UTC` | Time zone |

## Docker / Compose

```bash
git clone https://github.com/ernest-it/open-nutrition.git
cd open-nutrition
docker compose up -d          # builds the image the first time
open http://localhost:8080    # create your account right away: the first one becomes admin
```

Once CI publishes images, replace `build: .` with `image: ghcr.io/ernest-it/open-nutrition:latest` in `docker-compose.yml`. The images are multi-arch (amd64 and arm64), so they also run on a Raspberry Pi 4/5.

**Image details:**
- Debian slim + Node 22.
- Runs as the non-root `node` user (uid 1000).
- Healthcheck on `/api/v1/health`.
- A single volume at `/data`.

### Reverse proxy and HTTPS

The mobile app works over plain HTTP on your LAN. HTTPS is strongly recommended as soon as the server is reachable from outside your network. Example `Caddyfile`:

```
nutrition.example.com {
    reverse_proxy open-nutrition:8080
}
```

Set `TRUST_PROXY=true`. Traefik and nginx-proxy-manager work the same way: proxy everything to port 8080. No websockets are needed.

**Remote access without opening ports:** Tailscale or a Cloudflare Tunnel in front of the container works well. Point the app at the tailnet or tunnel hostname.

## Kubernetes

```bash
# edit the image tag, the Ingress host and ingressClassName first
kubectl apply -k deploy/k8s
```

`deploy/k8s/open-nutrition.yaml` contains:
- Namespace
- PVC (1 Gi)
- ConfigMap
- Deployment
- Service
- Ingress

**Important:** SQLite means **exactly one replica**. The Deployment uses `strategy: Recreate` and a `ReadWriteOnce` volume. That's plenty: a single instance easily serves a family.

**The pod is hardened:**
- non-root user
- read-only root filesystem
- all capabilities dropped
- no privilege escalation

For TLS, add a `tls:` block to the Ingress (cert-manager), or use your cluster's default certificate.

## Proxmox

### Option A: LXC without Docker (lightest)

On the Proxmox host:

```bash
pveam update && pveam available | grep debian-12    # find the template name
pveam download local debian-12-standard_12.7-1_amd64.tar.zst
pct create 210 local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst \
  --hostname open-nutrition --cores 1 --memory 512 --rootfs local-lvm:4 \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp --unprivileged 1
pct start 210
pct push 210 deploy/proxmox/install-lxc.sh /root/install-lxc.sh
pct exec 210 -- bash /root/install-lxc.sh
```

**What the script does:**
1. Installs Node 22.
2. Clones and builds the repo into `/opt/open-nutrition`.
3. Stores data in `/var/lib/open-nutrition`.
4. Runs the server as a hardened systemd service on port 8080.

Re-run the script to upgrade. Put extra settings in `/etc/default/open-nutrition`, e.g. `ALLOW_REGISTRATION=true`.

**Backups:** a Proxmox `vzdump` of the container covers everything.

### Option B: VM or LXC running Docker

Install Docker in a Debian VM, or in an LXC with `--features nesting=1,keyctl=1`, then follow the [Compose](#docker--compose) steps.

## Security

See [SECURITY.md](../SECURITY.md) for how to run a server safely and how to report vulnerabilities.

## Food data and the Open Food Facts cache

The bundled USDA database is read-only and shipped in the image (`FOOD_DB_PATH`). Products fetched from Open Food Facts are stored in an `off_cache` table inside the server's SQLite file, separate from user data, and requested with a custom User-Agent. Open Food Facts allows about 15 product reads per minute per IP, which the cache helps you stay under. See [LICENSING.md](../LICENSING.md#data-licenses).

## Backups

All state lives in **one SQLite database** in `/data`. Any of these work:

```bash
# consistent online backup (works while the server runs)
docker exec open-nutrition node -e "require('better-sqlite3')('/data/open-nutrition.db').backup('/data/backup.db').then(()=>console.log('ok'))"

# or: stop the container and copy the volume
docker compose stop && docker run --rm -v open-nutrition_open-nutrition-data:/data -v "$PWD":/b debian cp /data/open-nutrition.db /b/ && docker compose start
```

Each user can also download a **full JSON backup** or a **diary CSV** from Settings in the web UI.

## Upgrading

- Database migrations are additive and run automatically on start.
- Before a major version, back up `/data`.

## Release signing (Android)

The release workflow signs the APK with a keystore created for Open Nutrition only. Never reuse the Open Workouts keystore. Add these repository secrets before tagging a release:

| Secret | Value |
|---|---|
| `ON_ANDROID_KEYSTORE_BASE64` | The release keystore, base64-encoded |
| `ON_ANDROID_KEYSTORE_PASSWORD` | Keystore (and key) password |
| `ON_ANDROID_KEY_ALIAS` | Key alias inside the keystore |

Back the keystore up somewhere safe. If it's lost, updates can't be installed over existing installs.
