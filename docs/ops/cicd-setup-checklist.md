# CI/CD Setup Checklist (Step-by-Step)

## Step 1. Commit bootstrap files

```bash
git add .github/workflows docker-compose.prod.yml deploy docs .env.example
git commit -m "chore: add docker ci/cd with cloudflare tunnel deployment"
git push origin main
```

## Step 2. Configure GitHub Secrets

Set repository secrets:

- `MAC_HOST`: Mac mini IP or DNS
- `MAC_PORT`: SSH port (default `22`)
- `MAC_USER`: deploy user (for example `deploy`)
- `MAC_SSH_KEY`: private key content (PEM)

`GITHUB_TOKEN` is used automatically by Actions for GHCR push.

## Step 3. Prepare Mac mini

```bash
sudo mkdir -p /opt/sync_save
sudo chown -R "$USER":staff /opt/sync_save
```

Copy repository files to `/opt/sync_save` and create env file:

```bash
cp .env.example /opt/sync_save/.env
```

Edit `/opt/sync_save/.env`:

- Set `GHCR_REPO` to `<owner>/<repo>`
- Set `CLOUDFLARE_TUNNEL_TOKEN`
- Set app secrets (`JWT_SECRET`, `DATABASE_URL`, etc.)

## Step 4. Validate SSH deployment path

From local machine:

```bash
ssh -p 22 deploy@<MAC_HOST> "cd /opt/sync_save && ls -la && ./deploy/redeploy.sh"
```

Expected behavior now:
- Script exits because `DEPLOY_SHA` is missing (this is normal for this check).

## Step 5. First CI/CD run

Push a commit to `main` and verify:

1. `CI` workflow succeeds and pushes images:
- `ghcr.io/<owner>/<repo>/api:sha-<commit>`
- `ghcr.io/<owner>/<repo>/web:sha-<commit>`
2. `CD` workflow runs and updates Mac mini services.
3. Healthcheck passes.

## Step 6. Verify runtime

On Mac mini:

```bash
cd /opt/sync_save
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f api web cloudflared
```

Public checks:

- `https://app.example.com`
- `https://api.example.com/health`
