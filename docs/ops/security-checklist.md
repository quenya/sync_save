# Deployment Security Checklist

## 인증/토큰
- [ ] `JWT_SECRET` 및 토큰 비밀값을 `.env` 외부로 노출하지 않음
- [ ] `refreshToken` 회전 정책 실행 빈도 점검
- [ ] 세션 삭제(로그아웃/탈퇴) 후 즉시 401 응답 확인

## 네트워크/접근 제어
- [ ] API/Web 포트가 Cloudflare Tunnel 이외 노출되지 않음
- [ ] SSH 키 인증만 사용, 루트 로그인 비활성화
- [ ] 서비스간 통신은 내부 DNS 기반으로 분리

## 데이터 보호
- [ ] 게임/리비전은 반드시 `userId`로 스코핑(교차 조회 테스트)
- [ ] 업로드는 사용자별 디렉터리 하위로만 저장 (`/mock-storage/users/{userId}/...`)
- [ ] 저장 토큰/로그인 토큰은 로그에서 마스킹

## 운영 운영성
- [ ] `deploy/redeploy.sh` 실패 시 롤백 태그 확인
- [ ] `docker compose logs -f api web cloudflared` 상시 확인
- [ ] rate limit 적용 여부(게이트웨이/리버스 정책) 문서화
