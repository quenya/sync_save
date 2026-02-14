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

## 5) Security Notes

- Keep SSH key-based auth only.
- Do not expose API/Web ports directly on router.
- Restrict Mac mini sleep mode to avoid deployment failures.
