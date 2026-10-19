import { useEffect, useRef, useState } from 'react';
import { X, Link as LinkIcon, LockKeyhole } from 'lucide-react';
import { createNovel } from '../../shared/novels';
import { serverApi } from '../services/folioApi';
import type { useNovelLibrary } from '../hooks/useNovelLibrary';
import { FileUpload } from './FileUpload';
import { WctCatalog } from './WctCatalog';
type Library = ReturnType<typeof useNovelLibrary>;
const TEST_URL = 'https://witchculttranslation.com/2021/01/29/arc-7-chapter-2-animal-tracking/';
export function LibraryDialog({ library, onClose }: { library: Library; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [password, setPassword] = useState('');
  const [url, setUrl] = useState(TEST_URL);
  const [title, setTitle] = useState('Arc 7, Chapter 2 — Animal Tracking');
  const [arc, setArc] = useState(7);
  const [chapter, setChapter] = useState(2);
  const [text, setText] = useState('');
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [problem, setProblem] = useState('');
  const [tab, setTab] = useState<'url' | 'file' | 'catalog'>('url');
  useEffect(() => { const element = dialog.current!; const previous = document.body.style.overflow; document.body.style.overflow = 'hidden'; element.showModal(); return () => { element.close(); document.body.style.overflow = previous; }; }, []);
  async function perform(work: () => Promise<void>) {
    setBusy(true); setProblem(''); setMessage('');
    try { await work(); } catch (error) { setProblem(error instanceof Error ? error.message : '요청을 처리하지 못했습니다.'); }
    finally { setBusy(false); setPassword(''); }
  }
  return <dialog ref={dialog} className="library-dialog" aria-labelledby="library-dialog-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="library-dialog-header"><div><span className="eyebrow">YOUR PRIVATE LIBRARY</span><h2 id="library-dialog-title">이야기를 서재에 담기</h2></div><button className="icon-button" aria-label="서재 관리 닫기" onClick={onClose}><X size={21} /></button></div>
    <div className="library-methods" role="tablist" aria-label="소설 등록 방법">{([['url', '소설 URL'], ['file', 'EPUB / TXT'], ['catalog', 'WCT 7장 목차']] as const).map(([id, label]) => <button key={id} role="tab" id={`library-${id}-tab`} aria-controls={`library-${id}-panel`} aria-selected={tab === id} disabled={busy} onClick={() => { setTab(id); setProblem(''); setMessage(''); }}>{label}</button>)}</div>
    <div role="tabpanel" id={`library-${tab}-panel`} aria-labelledby={`library-${tab}-tab`}>
    {tab === 'catalog' && <WctCatalog library={library} onRead={(id) => { library.select(id); onClose(); }} onPrepare={(entry) => { setUrl(entry.url); setTitle(`Arc 7, Chapter ${entry.number} — ${entry.title}`.slice(0, 200)); setArc(7); setChapter(parseInt(entry.number)); setTab('url'); setProblem(''); }} />}
    {tab === 'file' && <FileUpload busy={busy} perform={perform} onImport={async (novels) => { await library.addMany(novels); onClose(); }} />}
    {tab === 'url' && <>
    <section className="library-auth">
      <h3><LockKeyhole size={14} /> 개인용 서버 연결</h3>
      {!library.session.configured && <p>인증 환경변수가 아직 설정되지 않았습니다. 수동 원문은 로그인 없이 이 기기에 저장할 수 있습니다.</p>}
      {library.session.authenticated ? <div className="server-actions"><span>로그인됨 · {library.session.model}</span><button disabled={busy} onClick={() => void perform(async () => { const result = await serverApi.verify(); setMessage(`${result.model} 호출 권한 확인됨. 무료 등급 여부는 결제 연결이 없는 프로젝트인지 AI Studio에서 확인해 주세요.`); })}>모델 연결 확인</button><button disabled={busy} onClick={() => void perform(async () => { await serverApi.logout(); await library.refreshSession(); })}>로그아웃</button></div> : <form onSubmit={(event) => { event.preventDefault(); void perform(async () => { await serverApi.login(password); await library.refreshSession(); setMessage('개인 서재에 로그인했습니다.'); }); }}><label htmlFor="library-password">서재 비밀번호</label><div className="form-row"><input id="library-password" type="password" autoComplete="current-password" value={password} maxLength={256} onChange={(event) => setPassword(event.target.value)} required /><button className="text-action" disabled={busy || !library.session.configured}>로그인</button></div></form>}
    </section>
    <form className="source-form" onSubmit={(event) => {
      event.preventDefault();
      void perform(async () => {
        try { await library.add(await serverApi.import(url.trim())); onClose(); }
        catch (error) { setManual(true); throw error; }
      });
    }}>
      <label htmlFor="novel-url"><LinkIcon size={14} /> 소설 URL</label>
      <input id="novel-url" type="url" value={url} onChange={(event) => setUrl(event.target.value)} maxLength={500} required />
      <p className="field-note">Witch Cult Translations 개별 화만 가져옵니다. 접근·robots 정책·운영자 이용 조건 검토를 확인하며 제한을 우회하지 않습니다.</p>
      <a className="source-page-link" href={/^https:\/\/(?:www\.)?witchculttranslation\.com\//.test(url) ? url : undefined} target="_blank" rel="noopener noreferrer">선택한 원본 페이지 열기 ↗</a>
      {!library.session.importEnabled && <p className="field-note">자동 가져오기가 비활성화되어 있습니다. 서버 로그인과 이용 조건·허가 확인이 필요합니다. EPUB/TXT 탭에서 파일을 등록할 수 있습니다.</p>}
      <button className="text-action" disabled={busy || !library.session.authenticated || !library.session.importEnabled}>{busy ? '확인 중…' : '한 화 가져오기'}</button>
    </form>
    <button className="manual-toggle" aria-expanded={manual} onClick={() => setManual((value) => !value)}>직접 원문 입력 {manual ? '접기' : '펼치기'}</button>
    {manual && <form className="manual-form" onSubmit={(event) => {
      event.preventDefault();
      void perform(async () => {
        let source: URL;
        try { source = new URL(url.trim()); } catch { throw Error('위 소설 URL을 확인해 주세요.'); }
        if (source.protocol !== 'https:' || !['witchculttranslation.com', 'www.witchculttranslation.com'].includes(source.hostname) || source.username || source.password || source.port || source.search || !/^\/\d{4}\/\d{2}\/\d{2}\/arc-\d+-chapter-\d+(?:-\d+)?-[a-z0-9-]+\/$/i.test(source.pathname)) throw Error('출처에는 Witch Cult Translations의 개별 화 HTTPS URL을 입력해 주세요.');
        source.hash = '';
        await library.add(await createNovel({ url: source.href, title, arc, chapter, kind: 'manual', texts: text.split(/\n[\t ]*\n+/), attribution: '사용자 수동 입력 · Witch Cult Translations · 원작 Tappei Nagatsuki' }));
        onClose();
      });
    }}>
      <p className="field-note">개인 열람·번역이 허용된 영어 원문을 입력하세요. 빈 줄로 문단을 구분하고, 문단 안 줄바꿈은 유지합니다.</p>
      <label htmlFor="manual-title">화 제목</label><input id="manual-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} required />
      <div className="form-row"><label>장 번호<input aria-label="장 번호" type="number" min="1" max="99" value={arc} onChange={(event) => setArc(Number(event.target.value))} required /></label><label>화 번호<input aria-label="화 번호" type="number" min="1" max="9999" value={chapter} onChange={(event) => setChapter(Number(event.target.value))} required /></label></div>
      <label htmlFor="manual-source">영어 원문</label><textarea id="manual-source" value={text} onChange={(event) => setText(event.target.value)} maxLength={150000} rows={10} required placeholder={'First paragraph.\n\nSecond paragraph.'} />
      <button className="text-action" disabled={busy}>이 기기에 저장</button>
    </form>}
    </>}
    </div>
    {message && <p className="library-message" role="status">{message}</p>}
    {problem && <p className="library-error" role="alert">{problem}</p>}
    <p className="field-note">원문과 번역은 이 브라우저의 IndexedDB에 저장됩니다. 무료 한도 도달 시 중단하며 유료 모델로 자동 전환하지 않습니다.</p>
  </dialog>;
}
