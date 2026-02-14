# First deploy on Mac mini

## 1) Clone & env

```bash
cd /tmp
git clone https://github.com/quenya/sync_save.git /opt/sync_save
cd /opt/sync_save
cp .env.example .env
```

Edit `.env`:

- `GHCR_REPO=quenya/sync_save`
- `CLOUDFLARE_TUNNEL_TOKEN=<token>`
- app runtime secrets (`JWT_SECRET`, `DATABASE_URL`, etc.)

## 2) Initial start

```bash
./deploy/setup-macmini.sh
```

## 3) First Cloudflare Tunnel check

```bash
./deploy/update-dns.sh
```

Cloudflare 대시보드에서 Tunnel 호스트를 확인합니다.

- `api.example.com -> http://api:3000`
- `app.example.com -> http://web:3001`

## 4) GitHub Actions secret checks

Set these in GitHub repo secrets:

- `MAC_HOST`
- `MAC_PORT`
- `MAC_USER`
- `MAC_SSH_KEY`

## 5) Dry run sync

```bash
ssh -p "$MAC_PORT" "$MAC_USER@$MAC_HOST" "cd /opt/sync_save && ./deploy/redeploy.sh"
```

`DEPLOY_SHA` 없이 실행하면 `DEPLOY_SHA is required`로 종료되므로, 실제 배포는 GitHub Actions 푸시 후 자동 동작을 확인하세요.
