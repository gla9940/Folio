# EPUB Gemini 400 진단 및 수정

기준일: 2026-10-19 (Asia/Seoul).

## 확인한 사실과 한계

- 기존 `generateTranslation`은 Google의 오류 본문을 읽지 않고 모든 400을 `GEMINI_FAILED`/HTTP 502로 바꿨다. 따라서 과거 응답의 정확한 사유는 기존 로그로 복원할 수 없다.
- 로컬 `[WN] ReZero Volume 26 - Extras Optimized.epub`(12,582,367바이트)을 실제 Folio EPUB 파서로 분석했다. 사용자가 알려준 이름은 `ReZero_Arc7_Volume26_WCT.epub`이며 동일한 파일 바이트인지 비교할 수는 없지만, 크기와 첫 본문의 13구간 현상이 일치한다.
- 앞부분 안내 다음의 첫 본문은 386문단·46,822자·13구간이다. 첫 구간은 31문단·3,927자이고 문단 ID 길이는 49자다. 요청은 기존 4,000자 목표·서버 6,000자 제한 안에 있다.
- 실제 EPUB 내용은 Git이나 진단 로그에 기록하지 않았다. 원본 파일과 사용자의 IndexedDB/localStorage는 수정·삭제하지 않았다. 별도의 격리된 테스트 브라우저 메모리에서 파싱했다.
- 운영 주소 `https://folio-dusky-xi.vercel.app/`와 `/api/folio`는 200이다. 서버 키는 로컬에 없다. 구조 비교 자체에는 실제 Gemini 호출을 사용하지 않았으며, 수정 배포 후 사용자가 내장 브라우저의 개인 인증을 완료하여 아래 최소 1회 운영 검증을 수행했다.

## 요청 구조 비교

숫자는 동일한 실제 EPUB 입력을 기존/수정 요청 빌더에 통과시킨 결과다. Google 호출·번역 품질 검증은 아니다.

| 항목 | 짧은 문장(기존) | EPUB 첫 구간(기존) | EPUB 첫 구간(수정) |
| --- | ---: | ---: | ---: |
| 대상 문단 | 1 | 31 | 31 |
| 원문 문자 | 13 | 3,927 | 3,927 |
| 스키마 ID enum | 1 | 31 | 없음 |
| minItems / maxItems | 1 / 1 | 31 / 31 | 없음 |
| 스키마 UTF-8 바이트 | 307 | 1,909 | 202 |
| 전체 요청 UTF-8 바이트 | 2,615 | 11,031 | 9,306 |

짧은 입력과 달리 EPUB의 스키마는 긴 ID 선택지와 배열 길이 제약이 함께 증가한다. 스키마 복잡성 제한은 유력한 가설이나, 과거 Google 오류 응답을 확보하지 못했으므로 실제 400 원인으로 확정하지 않는다. [Google 구조화 출력 문서](https://ai.google.dev/gemini-api/docs/structured-output?hl=en)는 과도한 스키마 복잡성으로 요청이 거절될 수 있다고 설명한다.

## 수정

- `buildTranslationRequest`로 REST 요청 빌더를 분리했다. 고정 `object → paragraphs[] → {id:string,text:string}` 스키마와 필수 필드만 전송한다. 동적 enum, minItems/maxItems, additionalProperties 제약을 제거했다.
- 기존 프롬프트·용어집·문단 ID·본문은 그대로 전달하고 `validateTranslation`의 ID·개수·순서·줄바꿈 검증을 유지했다. 13구간 경계와 성공 캐시 키는 바꾸지 않았다.
- 모델은 `gemini-3.8-flash`로 유지한다. [Google 문제 해결 문서](https://ai.google.dev/gemini-api/docs/troubleshooting?hl=en)가 Gemini 3.6+에서 사용하지 말 것을 안내하는 `temperature`만 요청에서 제거했다. 이것을 이번 400의 확인된 원인이라고 주장하지 않는다.
- Google 400 → `GEMINI_BAD_REQUEST`/HTTP 400, 키/권한 → `GEMINI_AUTH`, Google 429 → `GEMINI_QUOTA`, Folio 제한 → `RATE_LIMITED`로 구분한다. 400은 자동 재시도나 모델 전환을 하지 않는다.
- 같은 요청의 400은 기존 Redis에 요청 형식 버전별로 5분간 기록하여 반복 모델 호출을 막는다. 인증·분당/일일 제한은 그대로이며, 실제 실패한 호출도 한도를 소비한다. 기존 Folio 제한을 초기화하거나 늘리지 않았다.
- 클라이언트는 재시도 불가 오류와 제한 대기 시각을 기존 번역 구간에 저장한다. 400 뒤에는 ‘요청 수정 필요’, 429 대기 중에는 ‘잠시 후 재시도’를 비활성화해 표시한다. 새로고침 후에도 유지한다. 요청 형식 버전만 변경하면 이전 형식의 차단을 해제할 수 있고, 이미 완료된 번역은 보존한다.

## 안전한 Vercel 로그

`folio.gemini.failure` 이벤트에서 진단 ID를 검색한다. 기록 항목은 고정 모델/요청 버전, upstream HTTP 상태, 허용된 Google 상태 코드, 고정 사유 분류, 허용된 설정 필드 이름, 문단 수·문자 수·요청/스키마 바이트·소요 시간이다.

- `schema_complexity`: Google 메시지에서 스키마/enum 복잡성·상태 수·중첩 깊이 제한을 식별함.
- `unsupported_parameter`, `input_size`, `credentials`, `billing_or_region`, `invalid_argument`, `quota`, `model_unavailable`, `upstream_error`: 고정 분류이며 분류할 수 없는 400은 `invalid_argument`로 남긴다.
- Google 오류 본문은 16KiB까지만 읽고 분류에만 사용한다. 원문 메시지·details·임의 필드 경로는 출력하지 않는다. API 키, 인증 헤더, 원문 URL/해시/문단 ID, 문장, 프롬프트, 번역 결과는 기록하지 않는다.
- 응답에 키나 원문이 포함된 경우에도 고정 라벨만 로그에 남도록 테스트했다. `message` 전체를 로그에 추가하는 식으로 진단을 확장하지 말아야 한다.

## 검증

- `npm test`: 35개 통과. EPUB 크기의 고정 스키마, 민감 정보 없는 400 진단, 출력 문단 검증, 반복 400 차단과 429 쿨다운 분리 포함.
- `npm run test:e2e`: 31개 통과. 기존 EPUB/번역 캐시·PC/모바일 페이지·기록·북마크, 400 후 단일 호출/새로고침 차단, 429 대기 후 미완료 구간만 재시도 포함.
- `npm run build`: TypeScript + Vite 통과.
- 수정 커밋 `43c71f1`의 Vercel 배포 성공 후, 개인 인증된 운영 Folio에서 위 Volume 26 파일을 등록하고 `Arc 7 Chapter 1 – Baptism`(13구간)을 선택했다.
- **실제 Gemini 첫 구간 1회 호출 성공.** 진행률이 `0 / 13`에서 `1 / 13`으로 바뀌었고 오류 표시는 없었다. 다음 요청 전 21초 보호 대기 안에 ‘번역 중단’을 눌렀다. 나머지 12구간은 요청하지 않았다.
- 운영 페이지를 새로고침한 후에도 같은 화·`1 / 13 구간`·‘이어서 번역’ 버튼이 유지되며 오류 표시가 없음을 확인했다. API 키를 가져오거나 로그에 노출하지 않았다.
- **한계:** 13구간 전체 번역 및 번역 품질 검수는 수행하지 않았다. 수정 전의 실제 Google 400 응답은 복원할 수 없으므로, 스키마 복잡성이 과거 오류의 확정 원인이라는 주장은 하지 않는다. 실제 첫 구간 성공은 이번 수정 후 확인한 결과다.
