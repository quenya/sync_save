# Integration Test Scenarios

## 1) 인증/세션
- Google OAuth 로그인 성공
- Facebook OAuth 로그인 성공
- 동일 이메일 다중 provider 링크 확인
- 토큰 갱신 / 로그아웃 / 계정 삭제 동작 확인

## 2) 계정 격리
- 사용자 A/B가 각각 게임을 생성한 뒤 서로의 `/games/:id` 접근 시 403
- 사용자별 리비전 업로드 및 조회가 서로 다름

## 3) 저장 동기화 핵심
- 게임 등록 시 저장 경로 자동 정규화 (`/users/{userId}/...`)
- `POST /games/:id/revisions` 생성
- 최신 조회, 목록 조회, 다운로드 조회
- stale `clientUpdatedAt`로 409 conflict 발생
- resolve API로 `revision_conflict` 해제 후 업로드 성공

## 4) 운영 점검
- `docker compose -f docker-compose.prod.yml up -d` 후 `/health` 검사
- tunnel/도메인 체크스트링 테스트(문서 동작 시나리오)

## 5) 실행 체크 (동작 검증)

### API 단위/통합
- 실행:
  - `npm test`
- 기대:
  - 13개 테스트 통과 (현재 기준)

### 엔드투엔드 스모크 체크
- 실행 예시:
  - 아래 스크립트 로직으로 확인: `health`, `oauth/login`, `me`, `games CRUD`, `revision 업로드/최신/목록/다운로드`, `artifact upload`, `conflict+resolve`, `refresh(기존 토큰 폐기)`, `delete`
- 기대:
  - health 200
  - oauth/login 성공
  - 게임 생성/조회 성공
  - 리비전 업로드/최신/목록/다운로드 성공
  - artifact 업로드 시 mock artifactPath 생성
  - stale 업로드 시 409, resolve 성공
  - refresh 성공 + 이전 access token 무효화 + 최신 token으로 계정 삭제 성공

### 권장 동작 확인 수치
- 기준 통과 수: `14/14`
