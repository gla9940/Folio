# Folio

개인용 웹소설 리더. React + TypeScript + Vite로 만든 모바일 우선 웹 앱입니다.
창작 샘플을 보존하면서 Witch Cult Translations의 한 화 가져오기·수동 입력, EPUB/TXT 등록과 Gemini 한국어 번역을 지원합니다. 실제 소설 원문과 API 키는 저장소에 포함하지 않습니다.

## 실행

Node.js 22.12 이상 권장.

```sh
npm ci
npm run dev
```

```sh
npm run build      # TypeScript 검사 + 프로덕션 빌드
npm run preview    # 빌드 결과 미리보기
npm test           # 저장소 단위 테스트
npm run test:e2e   # 실제 브라우저 기능 테스트
npm run check:source # 7장 2화 HTTP·robots·추출 진단 (Gemini 호출 없음)
```

브라우저 테스트는 기본적으로 설치된 Microsoft Edge를 사용합니다. 다른 환경에서는
`npx playwright install chromium` 후 `PLAYWRIGHT_CHANNEL=chromium` 환경변수를 설정하세요.
PowerShell에서는 `$env:PLAYWRIGHT_CHANNEL='chromium'`을 사용합니다.

## 구현

- PC: 좌측 장별 목차·북마크, 중앙 본문, 우측 읽기 설정. 태블릿은 설정을 서랍으로 표시.
- 모바일: 본문을 터치해 상단·하단 메뉴 숨김·표시. 목차와 설정은 닫기·Escape·포커스 순환을 지원하는 서랍.
- 세피아·라이트·다크 테마, 글자 크기 14–28px, 줄 간격 1.4–2.6, 본문 최대 너비 480–840px.
- 2개 장, 6개 화의 창작 샘플. 이전·다음 화 이동, 문단 북마크 저장·이동·삭제.
- 읽던 화·문단·스크롤 위치와 설정, 북마크를 localStorage에 자동 저장. 손상 데이터와 저장 실패 대응.
- 한국어 본문 서체를 로컬 번들에 포함. Safe Area, 좁은 화면, 긴 문장, 큰 글자 대응.
- 읽기 설정에서 세로 스크롤 / 가로 페이지 전환. 가로 모드는 화면 높이에 맞춰 자동 조판하고, 한 번에 한 페이지씩 이동.
- PC: 좌우 방향키·페이지 버튼. 모바일: 좌우 스와이프·화면 양쪽 터치, 가운데 터치로 메뉴 표시·숨김.
- 현재 페이지 / 전체 페이지 및 해당 화 진행률 표시. 글자·줄 간격·본문 너비·화면·폰트 로딩 변경 시 재조판.

localStorage는 현재 브라우저·기기·접속 주소에 한정됩니다. 스크롤 저장은 스크롤 종료 약 180ms 후와 페이지 숨김·종료 시 수행합니다. 모바일에서는 본문 너비가 화면에 맞게 제한됩니다.

가로 모드는 CSS 다단 조판으로 원본 문단·대사·줄바꿈을 유지합니다. 짧은 문단은 가능한 한 함께 배치하고, 한 화면보다 긴 문단은 줄 단위로 이어집니다. 저장 위치는 페이지 번호 대신 문단 ID와 UTF-16 문자 위치를 사용하므로 모드나 화면 크기가 바뀌어도 같은 문장에 가까운 페이지를 찾습니다. 장 끝 안내 페이지만 표시한 경우에는 끝 위치도 함께 기록합니다. 이전 버전의 저장 데이터는 그대로 읽습니다.

Safe Area, `100dvh`, Visual Viewport의 높이·위치 변경을 반영합니다. 메뉴를 숨겨도 조판 영역은 유지해 불필요한 페이지 이동을 방지합니다. 이동 애니메이션은 220ms이며, 운영체제의 모션 줄이기 설정을 따릅니다. 검증은 데스크톱 Edge 및 모바일 터치 에뮬레이션으로 수행하며, 실기기 Safari의 주소창·노치 동작은 별도 확인이 필요합니다.

## 구조와 확장 지점

```text
src/
  domain/models.ts                 # 책 / 장 / 화 / 문단 / 북마크 / 읽기 상태
  services/contracts.ts            # BookRepository, ReaderStorage, TranslationProvider
  services/localReaderStorage.ts   # 버전별 저장 키, 검증, 안전한 브라우저 저장
  data/sampleBook.ts               # 비동기 샘플 BookRepository 어댑터
  hooks/useReader.ts               # 읽기 상태, 위치 복원, 저장, 화 이동
  hooks/useVisualViewport.ts       # 모바일 주소창·뷰포트 높이 반영
  domain/readingPosition.ts        # DOM 문단·문자 위치 공통 계산
  components/                     # 목차, 읽기 설정, 반응형 서랍
  components/PaginatedChapter.tsx  # 다단 조판, 페이지 이동·터치·키보드
  App.tsx                         # 데이터 로딩과 독서 화면 조합
tests/reader.spec.ts               # 데스크톱 / 모바일 브라우저 테스트
tests/pagination.spec.ts           # 가로 조판 / 긴 문단 / 재조판 / 위치 복원
```

## 원문·번역 사용

### 7장 목차와 파일 등록

- **소설 URL 추가 · 파일 / 7장 목차**에서 등록 방법을 선택합니다. **WCT 7장 목차**는 [공식 목차](https://witchculttranslation.com/table-of-content/)를 2026-10-19에 확인한 정적 메타데이터로, 1~110화와 54B~59B의 116개 제목·번호·원본 링크를 원래 순서대로 제공합니다. 검색, 원본 새 탭 열기, 한 화 등록 준비, 이미 등록한 화 읽기를 지원합니다. 앱이 이 목록의 본문을 자동으로 순회하지 않습니다.
- **EPUB / TXT**에서 파일 선택 → 추출된 목차 확인 → 책 제목 수정 → **N개 화 서재에 등록** 순서로 등록합니다. 여러 화는 한 권으로 묶이며 목차·이전/다음 화·북마크로 이동합니다. 같은 파일 바이트를 다시 선택하면 이름이 바뀌어도 중복되지 않으며 기존 번역·문단 ID·북마크를 유지합니다. 파일 내용이 변경되면 새 책으로 취급합니다.
- EPUB 2 NCX / EPUB 3 navigation 목차, OPF spine 읽기 순서, 같은 XHTML 안의 목차 앵커를 지원합니다. 본문은 텍스트로만 추출하고 대사의 `br` 줄바꿈·문단 순서를 보존합니다. 스크립트·메뉴·숨김 요소 등은 제외하며 HTML을 React에서 실행하지 않습니다. 이미지·CSS·외부 리소스는 불러오지 않습니다. DRM/암호화, 손상된 XML, 지원하지 않는 본문 형식은 오류로 안내합니다.
- TXT는 UTF-8(기본), UTF-16 LE/BE, EUC-KR을 선택할 수 있습니다. `Chapter N`, `Arc N, Chapter N`, `제N화`, `제N장` 제목으로 나누며 제목이 없으면 한 화로 등록합니다. 빈 줄로 문단을 나누고 문단 안 줄바꿈을 유지합니다. 제목이 아닌 일반 문장을 제목처럼 쓰면 분할될 수 있으므로 등록 전 목차를 확인하세요.
- 파일 최대 20MB, EPUB 전체 압축 해제 예상 크기 80MB·문서당 4MB·3,000개 파일, 전체 500화·1,000만 자 제한이 있습니다. 화별 기존 제한(15만 자·2,500문단·문단별 6,000자)을 넘으면 일부를 잘라 저장하지 않고 파일 분할을 안내합니다.
- 파일은 브라우저에서 분석하여 IndexedDB의 기존 `novels` 저장소에 원자적으로 저장합니다. 파일 원본이나 첨부 리소스는 서버에 전송하지 않습니다. **번역하기**를 누르면 현재 화의 영어 텍스트만 기존 Gemini 경로로 전달하며, 기존 인증·무료 사용량 제한·구간 캐시·재시도를 적용합니다. 새 외부 서비스나 환경변수는 필요하지 않습니다.
- 등록된 화의 목차에 **번역 완료 / 미번역**, **읽음 / 안 읽음**을 표시합니다. 읽음은 해당 화 진행률 98% 이상에서 기록하고 IndexedDB에 보존합니다. 읽던 위치·북마크·설정은 기존 localStorage를 계속 사용합니다. 원문 URL이 있는 화에는 출처 링크를 표시합니다.
- 원문 자동 가져오기는 기존 서버의 이용 조건 검토·허가 설정과 로그인 모두 확인되어야 활성화됩니다. 허가 여부를 확인할 수 없거나 접근이 제한되면 허용된 EPUB/TXT를 등록하세요. 54B 같은 특수 번호·일부 원본 URL의 번호 불일치는 기존 엄격한 원문 추출기가 거절할 수 있으며, 제한을 완화하거나 우회하지 않습니다.

1. 목차의 **소설 URL 추가**에서 개인 서재에 로그인합니다.
2. Witch Cult Translations 개별 화 URL을 가져옵니다. 접근·robots·리다이렉트·자동 처리 제한·운영자 이용 조건 검토를 확인합니다. 외부 리다이렉트·로그인·차단·알 수 없는 HTML 구조는 우회하지 않습니다.
3. 자동 수집을 허용할 수 없는 경우 **직접 원문 입력**을 사용합니다. 빈 줄로 문단을 구분하고 문단 안 줄바꿈은 유지합니다. 수동 저장은 외부 서버 호출 없이 사용할 수 있습니다.
4. **번역하기**는 최대 32문단·약 4,000자씩 문맥 단위로 처리합니다. 앞뒤 원문·직전 번역과 버전별 고유명사 용어집을 참고합니다. ID·순서·개수·줄바꿈·비정상 길이를 검증하며, 의미의 정확성·자연스러움은 별도 검수가 필요합니다.
5. 완료 구간은 IndexedDB에 즉시 저장합니다. 모든 구간이 끝나면 **한국어 / 원문 보기**를 전환할 수 있습니다. 중간 완료 구간도 보존되며, 중단 후 **이어서 번역**, 오류 후 **번역 재시도**로 미완료 구간만 요청합니다.
6. 캐시 키에는 원문 URL·화 ID·원문 SHA-256·모델·번역 프롬프트 및 용어집 버전이 포함됩니다. 원문이 바뀌면 별도 캐시를 사용합니다. 번역 후 새로고침해도 API를 다시 호출하지 않습니다.

문단 ID는 문단 내용 해시와 중복 순번으로 구성해 같은 원문을 다시 가져오거나 앞에 문단이 삽입돼도 유지됩니다. 원문과 번역은 동일한 문단 ID를 사용하며, 언어 전환 시 문단과 문단 내부 상대 위치로 읽던 곳을 복원하고 다시 조판합니다. 서재 선택·언어·원문·번역은 기기/브라우저/접속 주소별 IndexedDB에 보관합니다. 읽기 설정·북마크·진도 localStorage는 기존 키를 유지합니다. 기기 간 동기화는 없습니다.

## Vercel 설정

GitHub 프로젝트를 Vercel의 Vite 프로젝트로 연결합니다. Node.js 22 이상, 빌드 `npm run build`, 출력 `dist`, Fluid Compute 사용을 권장합니다. `api/folio.ts`는 Vercel Node 함수이며 `vercel.json`에서 최대 실행 시간 60초를 설정했습니다. 한 요청은 한 번역 구간만 처리하고 Gemini 응답은 35초에서 중단합니다. Hobby의 Fluid Compute 실행 시간 상한과 요청 한도는 [공식 문서](https://vercel.com/docs/functions/limitations)에서 확인하세요.

Vercel **Settings → Environment Variables**에 아래 값을 서버 전용으로 설정하고 다시 배포합니다. Production과 Preview는 실제 사용할 환경에 각각 설정합니다. `VITE_` 접두사를 사용하지 마세요.

| 이름 | 설정 |
| --- | --- |
| `FOLIO_ORIGIN` | 실제 배포된 HTTPS 주소의 origin. 경로·후행 `/` 없이, 예: `https://your-folio.vercel.app`. Preview에서는 해당 Preview origin 별도 설정 필요. |
| `FOLIO_PASSWORD` | 16자 이상의 충분히 긴 무작위 개인 서재 비밀번호. |
| `FOLIO_SESSION_SECRET` | 32자 이상의 무작위 서명 비밀. 비밀번호와 다르게 생성. |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis 무료 데이터베이스의 HTTPS REST URL (`*.upstash.io`). |
| `UPSTASH_REDIS_REST_TOKEN` | 같은 데이터베이스의 REST 쓰기 토큰. |
| `GEMINI_API_KEY` | AI Studio에서 만든 서버용 Gemini 키. API 제한을 Gemini API로 설정 권장. |
| `GEMINI_FREE_TIER_CONFIRMED` | 결제가 연결되지 않은 무료 프로젝트임을 운영자가 확인한 뒤 `true`. 미설정 시 생성 호출 거부. |
| `WCT_IMPORT_ALLOWED` | 사이트의 수집·재번역 이용 조건/필요한 허가를 검토하기 전에는 `false`. 검토 완료 후에만 `true`. |
| `WCT_POLICY_REVIEW_URL` | 실제 검토한 이용 조건 또는 허가의 HTTPS 참조 주소. |
| `WCT_POLICY_REVIEWED_AT` | 실제 검토일 ISO 날짜. 예: `2026-10-19`. |

비밀 값은 채팅·README·GitHub에 붙여 넣지 마세요. `.env.example`에는 이름만 있습니다. 로컬 개발은 `.env.example`을 `.env.local`로 복사해 값을 넣고 `FOLIO_ORIGIN=http://127.0.0.1:5173`으로 설정한 뒤 `npm run dev`를 사용합니다. 로컬 Vite 개발 서버에도 동일한 인증·요청 제한이 적용됩니다. `npm run preview`는 정적 빌드 미리보기로 서버 API를 제공하지 않습니다.

인증은 12시간 HMAC 서명 HttpOnly·SameSite=Strict 세션 쿠키(배포에서는 Secure)를 사용합니다. POST는 정확한 Origin 검증이 필요합니다. 인증/분산 제한 저장소가 없으면 외부 요청을 거부합니다. Upstash는 원격 인증·사용량 제한·동시 번역 잠금·30일 구간 응답 캐시만 담당하며 Supabase 동기화 기능은 없습니다. 비용/무료 한도는 해당 서비스 대시보드에서 확인하세요.

## 무료 사용량 보호

- 모델은 **`gemini-3.8-flash` 고정**입니다. 실패·404·429 시 다른 모델이나 유료 API로 자동 전환하지 않습니다.
- 서버의 전역 Gemini 생성 제한: 분당 3회, UTC 날짜별 하루 15회. 클라이언트는 새 구간 사이 21초 대기합니다. 모든 인스턴스·탭이 Redis 원자 카운터와 잠금을 공유합니다.
- 로그인은 전역 분당 12회, 원문 가져오기는 분당 2회·하루 10회, 인증 API는 분당 60회입니다. 초과 시 429를 반환합니다. robots에 명시적 crawl-delay가 있으면 자동 가져오기 대신 수동 입력으로 안내합니다.
- Gemini 429 발생 시 현재 작업을 중단하고 서버 공용 쿨다운을 기록합니다. 자동 재시도는 하지 않으며 완료 구간을 지우지 않습니다. 실패/시간 초과 후 실제 요청이 처리됐을 가능성까지 과금 0을 보장할 수 없으므로 무료 프로젝트 사용이 필요합니다.
- **Gemini 생성 API는 키가 무료/유료 프로젝트에 속했는지 알려 주지 않습니다.** `GEMINI_FREE_TIER_CONFIRMED`는 운영자 확인 표시이며 결제를 기술적으로 비활성화하는 설정이 아닙니다. **Cloud Billing이 연결되지 않은 프로젝트 키**를 사용하세요. 결제 연결·업그레이드는 이 앱에서 수행하지 않습니다.
- 공식 [모델 문서](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)와 [요금 문서](https://ai.google.dev/gemini-api/docs/pricing?hl=en)는 무료 등급을 제공하지만, 계정별 한도는 [AI Studio/한도 안내](https://ai.google.dev/gemini-api/docs/rate-limits)에서 별도로 확인해야 합니다. 무료 등급 콘텐츠의 Google 서비스 개선 사용 여부도 약관에서 확인하세요.

## 서버·캐시 구조

```text
api/folio.ts                      # Vercel 함수 진입점
server/handler.ts                 # 로그인 / 가져오기 / 모델 확인 / 구간 번역
server/auth.ts                    # 개인 세션 및 Origin 제어
server/redis.ts                   # 분산 한도·잠금
server/source.ts                  # 도메인 제한·DNS 고정·robots·원문 추출
server/gemini.ts                  # 서버 키·고정 모델·구조화 출력 검증
shared/novels.ts                   # 원문 모델·해시·배치·캐시 키·검증
shared/glossary.ts                 # 리제로 용어집·소설 번역 지침
src/services/novelCache.ts         # IndexedDB 영속 저장
src/services/folioApi.ts           # 기존 TranslationProvider의 서버 어댑터
src/hooks/useNovelLibrary.ts       # 원문·번역·중단/재개 상태
tests/library.spec.ts              # 모의 API + 실제 브라우저 캐시·실패·언어 전환
```

## 검증 범위와 미완료 사항

[실제 검증 기록](docs/integration-verification.md)에 HTTP·robots·본문 추출과 실제 Gemini 번역 검증을 구분해 기록했습니다. 7장 2화의 실서버 접근 및 추출은 검증했습니다. 번역 브라우저 테스트는 자체 작성 텍스트와 모의 응답을 사용하며, **실제 Gemini 번역 성공이나 문학적 품질 검증을 의미하지 않습니다.** 배포 환경의 인증·요청 제한·모델 연결 확인 후 실제 한 화 번역과 캐시 재열람 검증이 필요합니다.

이번 범위에는 전체 목차/작품 일괄 수집, 접근 우회, Supabase 동기화, PWA를 포함하지 않습니다.
