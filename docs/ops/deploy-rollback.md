# Deploy and Rollback Runbook

## Deploy path

1. Push commit to `main`.
2. `CI` builds and pushes `sha-<commit>` tags to GHCR.
3. `CD` connects to Mac mini over SSH and runs:
- `DEPLOY_SHA=<commit_sha> ./deploy/redeploy.sh`
4. Script pulls containers and runs healthcheck.

Pre-flight checks (`.env` values):

- `GHCR_REPO` must be set and not `your-org/your-repo`.
- `CLOUDFLARE_TUNNEL_TOKEN` must be set and not placeholder.
- Optional: `PROD_APP_HOST`, `PROD_API_HOST` for HTTPS smoke checks.

## Rollback behavior

- On success: stores deployed tag in `.last_successful_tag`
- On healthcheck failure: automatically restores previous successful tag
- If no previous tag exists: exits with failure and keeps latest attempted state

## Manual rollback

```bash
cd /opt/sync_save
export IMAGE_TAG=sha-<known_good_sha>
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d --remove-orphans
```

## Troubleshooting

- Verify GHCR auth on server:
```bash
docker login ghcr.io
```
- Check container health/logs:
```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f api web cloudflared
```

### Security checkpoints

- SSH check (key-only, allow list):
```bash
ss -ltnp | rg ':22\\s'
```

- Secret rotation:
- `.env` values on server
- GitHub Action secrets used for GHCR + deploy
- OAuth client secrets from providers

- Log/limit validation:
- Ensure `docker compose logs -f api` is available.
- Confirm rate-limit and abuse policies are configured before production traffic.
