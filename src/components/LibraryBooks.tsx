import { useMemo, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import type { useNovelLibrary } from '../hooks/useNovelLibrary';
import { bookProgress, libraryId } from '../domain/library';
import { createLocalReaderStorage } from '../services/localReaderStorage';

type Library = ReturnType<typeof useNovelLibrary>;
export function LibraryBooks({ library, onRead }: { library: Library; onRead: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('recent');
  const [menu, setMenu] = useState<string | null>(null);
  const [action, setAction] = useState<{ id: string; kind: 'rename' | 'delete' } | null>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const menuButtons = useRef(new Map<string, HTMLButtonElement>());
  const books = useMemo(() => {
    const storage = createLocalReaderStorage();
    return library.books.map((book) => {
      const members = library.entries.filter((entry) => libraryId(entry) === book.id).sort((a, b) => (a.collection?.order ?? 0) - (b.collection?.order ?? 0));
      const progress = storage.getProgress(book.id);
      const registered = Math.min(...members.map((entry) => Date.parse(entry.source.importedAt) || 0));
      return { ...book, members, registered, recent: Date.parse(progress?.updatedAt ?? '') || 0, percent: bookProgress(members, progress) };
    });
  }, [library.books, library.entries]);
  const recent = [...books].sort((a, b) => b.recent - a.recent).find((book) => book.recent > 0);
  const filtered = books.filter((book) => book.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a, b) =>
    (sort === 'title' ? a.title.localeCompare(b.title, 'ko', { numeric: true }) : sort === 'registered' ? b.registered - a.registered : b.recent - a.recent) || a.title.localeCompare(b.title, 'ko', { numeric: true }));
  const target = books.find((book) => book.id === action?.id);
  function cancel() {
    const id = action?.id; setAction(null); setProblem('');
    requestAnimationFrame(() => (id && menuButtons.current.get(id) || document.querySelector<HTMLButtonElement>('[aria-label="서재 관리 닫기"]'))?.focus());
  }
  async function submit() {
    if (!action || busy) return;
    setBusy(true); setProblem('');
    try {
      if (action.kind === 'rename') await library.renameBook(action.id, title);
      else await library.removeBook(action.id);
      cancel();
    } catch (error) { setProblem(error instanceof Error ? error.message : '변경 사항을 저장하지 못했습니다.'); }
    finally { setBusy(false); }
  }
  if (action && target) return <section className="book-action" role={action.kind === 'delete' ? 'alertdialog' : 'region'} aria-labelledby="book-action-title" aria-describedby="book-action-description" onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy) cancel(); } }}>
    <h3 id="book-action-title">{action.kind === 'delete' ? '책을 삭제할까요?' : '책 제목 수정'}</h3>
    <p id="book-action-description">{action.kind === 'delete' ? `‘${target.title}’의 ${target.members.length}개 화와 이 책의 북마크·독서 기록을 삭제합니다. 되돌릴 수 없습니다. 다른 책과 공통 읽기 설정은 유지됩니다.` : '제목만 변경합니다. 본문, 목차, 북마크와 읽던 위치는 유지됩니다.'}</p>
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      {action.kind === 'rename' && <label className="book-title-field">책 제목<input autoFocus maxLength={200} required value={title} disabled={busy} onChange={(event) => setTitle(event.target.value)} /></label>}
      {problem && <p role="alert" className="library-error">{problem}</p>}
      <div className="book-action-buttons"><button autoFocus={action.kind === 'delete'} type="button" disabled={busy} onClick={cancel}>취소</button><button className={action.kind === 'delete' ? 'danger' : ''} type="submit" disabled={busy || (action.kind === 'rename' && !title.trim())}>{busy ? '저장 중…' : action.kind === 'delete' ? '삭제 확인' : '제목 저장'}</button></div>
    </form>
  </section>;
  return <section className="library-books" aria-label="내 서재 책 목록">
    {recent && <section className="library-resume" aria-label="이어서 읽기"><span className="eyebrow">이어서 읽기</span><button onClick={() => onRead(recent.id)}><strong>{recent.title}</strong><span>{recent.percent}% · 계속 읽기 →</span></button></section>}
    <div className="library-search"><label>서재 검색<input type="search" placeholder="책 제목 검색" value={query} onChange={(event) => { setQuery(event.target.value); setMenu(null); }} /></label><label>정렬<select aria-label="서재 정렬" value={sort} onChange={(event) => { setSort(event.target.value); setMenu(null); }}><option value="recent">최근 읽은 순</option><option value="title">제목순</option><option value="registered">등록순</option></select></label></div>
    <p className="library-book-count" role="status">{filtered.length}권{query.trim() && ` / 전체 ${books.length}권`}</p>
    <ul className="library-book-list">{filtered.map((book) => <li key={book.id} data-book-id={book.id}>
      <div className="library-book-row"><button className="library-book-open" onClick={() => onRead(book.id)}><strong>{book.title}</strong><small>{book.members.length}개 화 · {book.recent ? `${book.percent}% 읽음` : '아직 읽지 않음'}</small></button><button className="icon-button" ref={(element) => { if (element) menuButtons.current.set(book.id, element); else menuButtons.current.delete(book.id); }} aria-label={`${book.title} 관리`} aria-haspopup="menu" aria-expanded={menu === book.id} onClick={() => setMenu(menu === book.id ? null : book.id)}><MoreHorizontal size={21} /></button></div>
      <div className="library-book-progress" role="progressbar" aria-label={`${book.title} 읽기 진행률`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={book.percent}><span style={{ width: `${book.percent}%` }} /></div>
      {menu === book.id && <div className="library-book-menu" role="menu" aria-label={`${book.title} 관리 메뉴`} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setMenu(null); menuButtons.current.get(book.id)?.focus(); } }}><button role="menuitem" onClick={() => { setAction({ id: book.id, kind: 'rename' }); setTitle(book.title); setMenu(null); }}>제목 수정</button><button className="danger" role="menuitem" onClick={() => { setAction({ id: book.id, kind: 'delete' }); setMenu(null); }}>책 삭제</button></div>}
    </li>)}</ul>
    {!filtered.length && <p className="library-empty">{books.length ? '검색한 제목의 책이 없습니다.' : '등록한 책이 없습니다. EPUB / TXT 탭에서 파일을 담아보세요.'}</p>}
  </section>;
}
