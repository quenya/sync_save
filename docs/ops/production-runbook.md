# 배포/롤백/비상복구 운영 Runbook (MVP)

## 배포 전 10분 체크

1. `.env` 검증
- `GHCR_REPO` 값 존재/유효
- `CLOUDFLARE_TUNNEL_TOKEN` 플레이스홀더 미설정
- 배포할 해시(`DEPLOY_SHA`) 준비

2. CI 확인
- 최신 이미지 태그가 GHCR에 push되었는지 확인

## 배포 실행

```bash
cd /opt/sync_save
DEPLOY_SHA=<commit_sha> ./deploy/redeploy.sh
```

성공 시 `.last_successful_tag`가 갱신되어야 함.

## 실패 시 롤백

- `redeploy.sh`는 API 헬스 실패 시 이전 태그로 자동 롤백 시도
- 수동 롤백:

```bash
cd /opt/sync_save
export IMAGE_TAG=sha-<known_good_sha>
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d --remove-orphans
```

## 비상복구

1. Cloudflare가 정상 응답이 안 나오면 터널 재시작: `docker compose restart cloudflared`
2. API/Web 컨테이너만 분리 점검: `docker compose logs -f api web`
3. 로그 저장소/회전 설정 점검
4. 필요 시 이전 안정 버전으로 즉시 롤백 후 원인 추적
