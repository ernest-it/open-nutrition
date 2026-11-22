# Security

## Reporting a vulnerability

Please **don't open a public issue** for security problems. Use GitHub's private vulnerability reporting instead: the **Security** tab of this repository → **Report a vulnerability**. Include steps to reproduce and the version or commit. You'll get an acknowledgement as soon as possible.

## Running a server safely

- **Create your account right after the first start.** The first account on a fresh server becomes the admin, and afterwards registration closes unless `ALLOW_REGISTRATION=true`. Don't expose a fresh server to the internet before you've signed up.
- **Use HTTPS for anything reachable from outside your network.** Put a reverse proxy in front (Caddy, Traefik, nginx), or use Tailscale or a Cloudflare Tunnel. The app allows plain `http://` only so it works on a home LAN.
- **Set `TRUST_PROXY=true` only when a reverse proxy is actually in front.** Otherwise clients can fake their IP address and get around rate limiting.
- **API tokens** (Settings → Devices & tokens) give full access to your data. Store them like passwords and revoke any you no longer use.
- **AI meal logging and your API key:**
  - With `LLM_PROVIDER=anthropic`, meal photos and descriptions are sent to Anthropic when a user runs an AI estimate. AI stays off until it is enabled.
  - The server key (`LLM_API_KEY`) lives only in the server environment. It is never synced, logged or sent to clients.
  - Spending is bounded by default: a server-wide monthly budget (`AI_MONTHLY_BUDGET_USD`, $25), per-user monthly and daily request caps (`AI_MONTHLY_LIMIT`, `AI_DAILY_LIMIT`), one AI request per user at a time, and a cap on web searches per estimate. One user action makes one request to Anthropic; the server never retries a failed request.
  - Create a **dedicated key** in a **Claude Console workspace with a monthly spend limit**, so a leaked key costs little and can be revoked without affecting anything else.
  - Open Food Facts lookups go through the server with a custom User-Agent and are cached separately from user data.
- **Keep the image updated:** `docker compose pull && docker compose up -d`.

## Built-in protections

- **Passwords** are hashed with scrypt.
- **API tokens** are random 256-bit values; only their SHA-256 hash is stored.
- **Logins and sign-ups are rate-limited** per IP. Changing your password signs out your other devices.
- **Authentication runs before any request body is read.** Anonymous requests are limited to 1 MB; only signed-in sync and import requests may be larger.
- **Users are isolated:** every row is keyed by its user, and sync rejects writes to built-in data and timestamps far in the future.
- **The web UI sends security headers:** a strict Content-Security-Policy, no framing, `nosniff`, and no referrer.
- **Deleting an account requires the password,** not just a token.
- **The container runs as a non-root user.** The Kubernetes manifest also drops all capabilities and uses a read-only root filesystem.

## API keys

- **Option A, server key (recommended for self-hosting):** the key is an environment variable on the server. Phones and the web UI ask your server, which calls Claude. The web UI never holds a key.
- **Option B, key on the device (local-only mode):** the key is stored in the phone's Keychain/Keystore via `expo-secure-store` and sent only to `api.anthropic.com`. It is never part of synced data, backups, logs or crash reports, and is shown masked (`sk-ant-…a1b2`) with a "Remove key" button.
- A hosted service never stores other people's keys; the hosted tier includes AI with a monthly cap instead.
- Rotate or revoke a key in the Claude Console if you think it leaked.
