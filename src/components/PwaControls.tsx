import { useState } from 'react';
import { applyPwaUpdate, checkPwaUpdate, installPwa, usePwa } from '../services/pwa';

export function PwaControls() {
  const pwa = usePwa();
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return <section className="pwa-controls notranslate" translate="no" lang="ko">
    {pwa.installable && !pwa.installed && <button className="pwa-install" onClick={() => void installPwa()}>Folio 앱 설치</button>}
    <details><summary>앱 설치 · 오프라인</summary>
      <p className="field-note" role="status">{pwa.runningStandalone ? '설치형 앱' : '브라우저에서 읽는 중'} · {pwa.online ? '온라인' : '오프라인'}<br />{pwa.ready ? '오프라인 준비 완료 · 등록한 책과 독서 기록은 이 기기에 저장됩니다.' : pwa.preparing ? '오프라인에 필요한 앱 파일을 준비하고 있습니다.' : '처음에는 온라인으로 열고 오프라인 준비 완료를 확인해 주세요.'}</p>
      {!pwa.installed && (ios ? <p className="field-note">iOS Safari의 공유 버튼 → 홈 화면에 추가 → 추가를 선택하세요. 앱으로 여는 옵션이 있으면 켜 주세요.</p> : !pwa.installable && <p className="field-note">Chrome에서 설치가 가능해지면 설치 버튼이 표시됩니다. 주소창 설치 아이콘이나 브라우저 메뉴에서도 설치할 수 있습니다.</p>)}
      <p className="field-note">설치형 화면에서는 브라우저 번역 메뉴가 제한될 수 있습니다. Chrome 기본 번역을 쓰려면 같은 주소를 Chrome 브라우저에서 여세요. iOS의 홈 화면 앱은 Safari와 저장 공간이 분리될 수 있으므로 설치 후 서재를 확인해 주세요.</p>
      <p className="field-note">등록한 EPUB/TXT만 오프라인으로 읽습니다. 외부 원본 링크와 브라우저 번역에는 인터넷 연결이 필요합니다. 앱 파일 갱신은 독서 기록을 삭제하지 않습니다.</p>
      {pwa.error && <p className="library-error" role="status">{pwa.error}</p>}
      {pwa.update ? <button onClick={() => void applyPwaUpdate()}>읽던 위치 저장 후 업데이트</button> : <button onClick={() => void checkPwaUpdate()}>오프라인 준비 · 업데이트 확인</button>}
    </details>
  </section>;
}
export function PwaUpdateNotice() {
  const pwa = usePwa(), [later, setLater] = useState(false);
  if (!pwa.update || later) return null;
  return <aside className="pwa-update notranslate" translate="no" lang="ko" aria-label="앱 업데이트">
    <p>새 Folio가 준비됐어요. 읽던 위치를 저장한 뒤 새로고침합니다.</p>
    {pwa.error && <p role="status">{pwa.error}</p>}
    <div><button onClick={() => void applyPwaUpdate()}>업데이트 · 새로고침</button><button onClick={() => setLater(true)}>나중에</button></div>
  </aside>;
}
