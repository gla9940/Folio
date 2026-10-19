import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { useNovelLibrary } from '../hooks/useNovelLibrary';
import { FileUpload } from './FileUpload';
import { WctCatalog } from './WctCatalog';
type Library = ReturnType<typeof useNovelLibrary>;
export function LibraryDialog({ library, onClose }: { library: Library; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [tab, setTab] = useState<'file' | 'catalog'>('file');
  useEffect(() => { const element = dialog.current!; const previous = document.body.style.overflow; document.body.style.overflow = 'hidden'; element.showModal(); return () => { element.close(); document.body.style.overflow = previous; }; }, []);
  async function perform(work: () => Promise<void>) {
    setBusy(true); setProblem('');
    try { await work(); } catch (error) { setProblem(error instanceof Error ? error.message : '파일을 처리하지 못했습니다.'); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="library-dialog notranslate" translate="no" lang="ko" aria-labelledby="library-dialog-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="library-dialog-header"><div><span className="eyebrow">YOUR PRIVATE LIBRARY</span><h2 id="library-dialog-title">이야기를 서재에 담기</h2></div><button className="icon-button" aria-label="서재 관리 닫기" onClick={onClose}><X size={21} /></button></div>
    <div className="library-methods" role="tablist" aria-label="소설 등록 방법">{([['file', 'EPUB / TXT'], ['catalog', 'WCT 7장 목차']] as const).map(([id, label]) => <button key={id} role="tab" id={`library-${id}-tab`} aria-controls={`library-${id}-panel`} aria-selected={tab === id} disabled={busy} onClick={() => { setTab(id); setProblem(''); }}>{label}</button>)}</div>
    <div role="tabpanel" id={`library-${tab}-panel`} aria-labelledby={`library-${tab}-tab`}>
      {tab === 'catalog' ? <WctCatalog library={library} onRead={(id) => { library.select(id); onClose(); }} /> : <FileUpload busy={busy} perform={perform} onImport={async (novels) => { await library.addMany(novels); onClose(); }} />}
    </div>
    {problem && <p className="library-error" role="alert">{problem}</p>}
    <p className="field-note">서재는 이 브라우저의 IndexedDB에 저장됩니다. 서버 설정이나 로그인 없이 사용할 수 있습니다.</p>
  </dialog>;
}
