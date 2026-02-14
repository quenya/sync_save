# Cloudflare Tunnel Setup (Mac mini)

## 1) Prerequisites

- Domain managed by Cloudflare
- Cloudflare Zero Trust account
- Mac mini with Docker and Docker Compose installed
- GitHub repo secrets configured for SSH deployment

## 2) Tunnel Creation

1. Create a tunnel in Cloudflare Zero Trust dashboard.
2. Create public hostnames:
- `app.example.com` -> `http://web:3001`
- `api.example.com` -> `http://api:3000`
3. Copy issued tunnel token.
4. Save token in `/opt/sync_save/.env`:

```env
CLOUDFLARE_TUNNEL_TOKEN=replace_me
```

When rotating tokens:

1. Issue a new token in Cloudflare Zero Trust dashboard.
2. Update `.env` and restart tunnel:

```bash
docker compose -f /opt/sync_save/docker-compose.prod.yml restart cloudflared
```

3. Remove old token from Cloudflare dashboard history.
4. Verify both hostnames.

## 3) OAuth Redirect URIs

- Google:
- `https://app.example.com/auth/callback/google`
- Facebook:
- `https://app.example.com/auth/callback/facebook`

Use the exact HTTPS production domains above in each provider console.

## 4) Mac mini Runtime

In `/opt/sync_save`, keep:

- `docker-compose.prod.yml`
- `.env`
- `deploy/redeploy.sh`

Start services:

```bash
docker compose -f docker-compose.prod.yml up -d
```

Check status:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f cloudflared
```

Optional route checks:

```bash
curl -I https://app.example.com/
curl -I https://api.example.com/health
```

## 5) Security Notes

- Keep SSH key-based auth only.
- Do not expose API/Web ports directly on router.
- Restrict Mac mini sleep mode to avoid deployment failures.

Recommended controls:

- Rotate tunnel token on team change.
- Keep OAuth redirect URIs aligned to HTTPS production hostnames.
- Use SSH allow list and disable password login.
