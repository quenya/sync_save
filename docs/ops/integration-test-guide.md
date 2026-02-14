# 통합 테스트 실행 가이드 (MVP)

## 사전조건

- API 서버 실행: `node api/server.js`
- 테스트용 `.env`는 별도 설정 불필요(인메모리 스토어 사용)

## 1) 인증/세션

```bash
curl -sS -X POST http://localhost:3000/auth/oauth/google \
  -H 'content-type: application/json' \
  -d '{"providerUserId":"google-user-1","email":"alice@example.com","name":"Alice"}'
```

반환값의 `accessToken`을 환경변수로 저장한 뒤:

```bash
curl -sS http://localhost:3000/me -H "authorization: Bearer $ACCESS_TOKEN"
curl -sS -X POST http://localhost:3000/auth/refresh \
  -H 'content-type: application/json' \
  -d '{"refreshToken":"'$REFRESH_TOKEN'"}'
```

## 2) 게임/리비전

```bash
GAME_ID=$(curl -sS -X POST http://localhost:3000/games \
  -H 'content-type: application/json' -H "authorization: Bearer $ACCESS_TOKEN" \
  -d '{"name":"Stardew Valley","savePath":"/users/1/saves/stardew"}' | jq '.game.id')

curl -sS http://localhost:3000/games -H "authorization: Bearer $ACCESS_TOKEN"

curl -sS -X POST http://localhost:3000/games/$GAME_ID/revisions \
  -H 'content-type: application/json' -H "authorization: Bearer $ACCESS_TOKEN" \
  -d '{"checksum":"sha256:aaa","sizeBytes":1024,"note":"manual"}'

curl -sS http://localhost:3000/games/$GAME_ID/revisions/latest -H "authorization: Bearer $ACCESS_TOKEN"
```

## 3) 충돌/해결

### 충돌 강제 재현

`clientUpdatedAt`을 과거로 보내 `409`를 확인한 뒤

```bash
curl -sS -X POST http://localhost:3000/games/$GAME_ID/revisions/$REVISION_ID/resolve \
  -H 'content-type: application/json' -H "authorization: Bearer $ACCESS_TOKEN" \
  -d '{"strategy":"overwrite-server"}'
```

동일한 과거 타임스탬프 재시도 시 `201`이 돌아와야 합니다.

## 4) 보안/격리

다른 사용자의 accessToken으로 동일 gameId 리소스 접근 시 `403`이 나와야 합니다.

```bash
curl -sS -X GET http://localhost:3000/games/$GAME_ID/revisions -H "authorization: Bearer $OTHER_ACCESS_TOKEN"
```
