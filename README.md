# Folio

개인용 웹소설 리더. React + TypeScript + Vite로 만든 모바일 우선 웹 앱입니다.
Re:제로 개인 서재를 위한 데모이며, 실제 소설 원문을 포함하지 않습니다.

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

localStorage는 현재 브라우저·기기·접속 주소에 한정됩니다. 스크롤 저장은 스크롤 종료 약 180ms 후와 페이지 숨김·종료 시 수행합니다. 모바일에서는 본문 너비가 화면에 맞게 제한됩니다.

## 구조와 확장 지점

```text
src/
  domain/models.ts                 # 책 / 장 / 화 / 문단 / 북마크 / 읽기 상태
  services/contracts.ts            # BookRepository, ReaderStorage, TranslationProvider
  services/localReaderStorage.ts   # 버전별 저장 키, 검증, 안전한 브라우저 저장
  data/sampleBook.ts               # 비동기 샘플 BookRepository 어댑터
  hooks/useReader.ts               # 읽기 상태, 위치 복원, 저장, 화 이동
  components/                     # 목차, 읽기 설정, 반응형 서랍
  App.tsx                         # 데이터 로딩과 독서 화면 조합
tests/reader.spec.ts               # 데스크톱 / 모바일 브라우저 테스트
```

다음 단계:

1. 실제 보유 콘텐츠를 `BookRepository` 어댑터로 연결. 문단 ID는 업데이트 후에도 안정적으로 유지.
2. Supabase 연결 전 인증·소유권·RLS를 설계하고, 동기 비동기 저장 경계와 충돌 정책을 정한 뒤 별도 원격 동기화 서비스를 추가.
3. `TranslationProvider`의 서버 어댑터 구현. API 키는 프런트엔드에 넣지 않고 서버에서 관리.
4. PWA manifest, 아이콘, 서비스 워커, 오프라인 캐시 및 업데이트 정책 추가.

이번 단계에는 크롤링, 외부 API 호출, Supabase, PWA 서비스 워커를 포함하지 않습니다.
