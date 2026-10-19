import { useState } from 'react';
import type { useNovelLibrary } from '../hooks/useNovelLibrary';
import { novelCache } from '../services/novelCache';

export function LibraryDiagnostics({ library }: { library: ReturnType<typeof useNovelLibrary> }) {
  const [busy, setBusy] = useState(false), [problem, setProblem] = useState('');
  const report = library.report;
  async function refresh() { setBusy(true); try { await library.diagnose(); } finally { setBusy(false); } }
  async function backup() {
    setBusy(true); setProblem('');
    try {
      const database = await novelCache.backup(), local: Record<string, string> = {};
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (key?.startsWith('folio:v1:')) { const value = localStorage.getItem(key); if (value !== null) local[key] = value; }
      }
      const url = URL.createObjectURL(new Blob([JSON.stringify({format: 'folio-readonly-backup-v1', origin: location.origin, exportedAt: new Date().toISOString(), database, localStorage: local})], {type: 'application/json'}));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `folio-backup-${new Date().toISOString().slice(0, 10)}.json`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch { setProblem('백업을 읽지 못했습니다. 저장소 접근을 확인해 주세요. 기존 데이터는 변경하지 않았습니다.'); }
    finally { setBusy(false); }
  }
  return <div className="library-diagnostics notranslate" translate="no" lang="ko">
    {!!report?.excluded && <p className="library-error" role="status">저장된 {report.total}개 화 중 {report.excluded}개 화를 표시하지 못했습니다. 데이터가 없는 상태가 아닙니다. 삭제·초기화하지 말고 진단과 원본 백업을 확인해 주세요.</p>}
    <details onToggle={(event) => { if (event.currentTarget.open) void refresh(); }}>
      <summary>서재 저장소 진단</summary>
      <p className="field-note">현재 브라우저의 {location.origin}<br />IndexedDB · folio-library-v1 · {report?.version ? `버전 ${report.version}` : report?.database === 'absent' ? '저장소 없음' : '확인하지 못함'}</p>
      {report && <><dl className="library-diagnostic-counts"><div><dt>원본 novels 저장 건수</dt><dd>{report.total}건</dd></div><div><dt>유효성 검사 통과</dt><dd>{report.valid}건</dd></div><div><dt>메모리 호환 표시</dt><dd>{report.compatible}건</dd></div><div><dt>표시 제외</dt><dd>{report.excluded}건</dd></div></dl>
        <p className="field-note">건수는 책이 아닌 화 레코드 기준입니다. 진단은 읽기 전용이며 본문·식별자·북마크를 수정하지 않습니다.</p>
        {!!Object.keys(report.reasons).length && <ul className="diagnostic-reasons">{Object.entries(report.reasons).map(([reason, count]) => <li key={reason}>{reason}: {count}건</li>)}</ul>}
        {!!report.compatible && <p className="field-note">식별자와 본문이 온전한 기존 데이터는 화면에서만 메타데이터를 보완해 표시합니다. 저장된 원본은 그대로 보존합니다.</p>}
        {report.total === 0 ? <p className="field-note">이 브라우저·현재 접속 주소의 novels 데이터가 실제 0건입니다. 다른 브라우저·프로필·기기·접속 주소의 데이터는 자동 복구할 수 없습니다. 처음 등록했던 브라우저와 정확히 같은 주소로 열어 주세요. 시크릿 모드나 브라우저 저장소 정리 여부도 확인해 주세요.</p> : <p className="field-note">먼저 원본 백업을 보관하고, 표시 제외 원인을 확인해 주세요. 동일한 EPUB 원본 파일을 재등록하면 기존 식별자가 일치하는 화의 북마크·읽던 위치를 연결합니다. 파일 바이트나 본문 구조가 다르면 기존 기록 연결을 보장할 수 없으며, 충돌하는 기존 원문은 덮어쓰지 않습니다.</p>}
      </>}
      {!report && <p className="field-note">접근 실패를 0건으로 판단하지 않습니다. 저장소를 지우지 말고 원래 브라우저·주소와 저장소 접근 설정을 확인해 주세요.</p>}
      {(library.diagnosticError || problem) && <p className="library-error" role="alert">{problem || library.diagnosticError}</p>}
      <div className="diagnostic-actions"><button disabled={busy} onClick={() => void refresh()}>다시 확인</button><button disabled={busy} onClick={() => void backup()}>서재 원본 백업</button></div>
      <p className="field-note">백업은 저장된 본문과 기록의 JSON 사본이며 서버로 전송하지 않습니다. EPUB 원본 파일 자체나 자동 백업 복원 기능은 포함하지 않습니다.</p>
    </details>
  </div>;
}
