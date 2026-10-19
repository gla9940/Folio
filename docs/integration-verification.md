# 실제 연동 검증 기록

기준일: 2026-10-19 (Asia/Seoul).

## 확인한 사항

- 대상: https://witchculttranslation.com/2021/01/29/arc-7-chapter-2-animal-tracking/
- Node 서버 HTTP 요청: robots.txt 200, 테스트 화 200. 해당 요청에서는 리다이렉트 없음.
- 실제 `fetchSource`의 도메인 제한·공인 DNS 고정·TLS 호스트 검증을 사용한 추출 진단 성공.
- 제목: Arc 7, Chapter 2 – “Animal Tracking”. 7장 2화, 356문단, 47,159자.
- 검증 시 본문 해시: `cd95a7446d45fe01beee39e983167ef5b2333f81d4a36910cf2fba244cf84303`.
- robots.txt는 전체 크롤러의 `/wp-admin/`을 막으며 테스트 화 경로는 차단하지 않음.
- 별도 자동 수집·재번역 허용 조건은 확인되지 않았음. robots 허용이 저작권 허가를 뜻하지 않음.
- 실제 원문은 Git에 넣지 않음. `.local/` 진단 파일은 Git에서 제외됨.

## 현재 미검증

- Gemini 키는 사용자가 Vercel에 설정했다고 알려 주었으나 로컬에는 없음.
- 실제 Gemini 생성 호출·해당 계정의 무료 등급·잔여 한도·번역 품질은 아직 검증하지 않음.
- Vercel 개인 인증·Upstash 환경변수와 운영자 원문 정책 검토 설정은 배포 후 확인 필요.
- 공식 모델·요금 문서는 `gemini-3.8-flash`와 무료 입력·출력을 확인할 수 있음. 이 사실만으로 특정 키의 요금제를 알 수는 없음.
- 브라우저 번역 테스트는 자체 작성 영어 텍스트와 모의 API 응답을 사용함. 실제 소설 번역 성공으로 간주하지 않음.
- iOS Safari 실기기 주소창·Safe Area 동작은 별도 확인 필요.

## 자동 테스트 결과

- `npm run build`: TypeScript 및 Vite 프로덕션 빌드 통과.
- `npm test`: 29개 통과. 인증·Origin·분산 제한·429 쿨다운·DNS/IP/리다이렉트 방어·원문 파싱·번역 문단 검증 포함.
- `npm run test:e2e`: 24개 통과. 기존 독서 17개 + 원문 서재/모의 번역 7개.
- 캐시 저장 보강 후 새 원문·번역 브라우저 테스트 7개를 다시 실행해 통과.
- 브라우저 번들에서 Gemini/Upstash 서버 호출·서버 환경변수 식별자가 포함되지 않음을 확인. 원문 로컬 진단 파일과 `.env.local`은 Git 제외 확인.

## 검증 재실행

```sh
npm run check:source
npm test
npm run test:e2e
npm run build
```

`check:source`는 한 화의 HTTP·robots·추출 진단만 수행하며 Gemini를 호출하지 않음. 운영 API의 정책 검토 설정을 대신하지 않음.

배포 후 서재에서 로그인 → 모델 연결 확인 → 이용 조건 검토 후 한 화 가져오기(또는 허용된 영어 원문 수동 입력) → 번역하기 → 한국어 전환 → 새로고침 → 가로 모드 및 원문 복귀 확인 순서로 실제 검증해야 함.

공식 참고:

- [Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)
- [Gemini 요금](https://ai.google.dev/gemini-api/docs/pricing?hl=en)
- [Gemini 한도](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Vercel 함수 제한](https://vercel.com/docs/functions/limitations)
- [Upstash REST](https://upstash.com/docs/redis/features/restapi)
