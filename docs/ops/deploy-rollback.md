# Deploy and Rollback Runbook

## Deploy path

1. Push commit to `main`.
2. `CI` builds and pushes `sha-<commit>` tags to GHCR.
3. `CD` connects to Mac mini over SSH and runs:
- `DEPLOY_SHA=<commit_sha> ./deploy/redeploy.sh`
4. Script pulls containers and runs healthcheck.

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
