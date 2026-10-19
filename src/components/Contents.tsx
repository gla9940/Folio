import { Bookmark as BookmarkIcon, Check, ChevronDown, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { Book, Bookmark } from '../domain/models';

interface Props {
  book: Book;
  chapterId: string;
  bookmarks: Bookmark[];
  tab: 'contents' | 'bookmarks';
  setTab: (tab: 'contents' | 'bookmarks') => void;
  onNavigate: (chapterId: string, paragraphId?: string) => void;
  onRemoveBookmark: (bookmark: Bookmark) => void;
  chapterStates?: Record<string, { translated: boolean; read: boolean; url?: string }>;
  library?: { selectedId: string; entries: { id: string; title: string }[]; onSelect: (id: string) => void; onOpen: () => void };
}
export function Contents({ book, chapterId, bookmarks, tab, setTab, onNavigate, onRemoveBookmark, library, chapterStates = {} }: Props) {
  const [collapsed, setCollapsed] = useState<string[]>([]);
  return <>
    {library && <div className="library-switcher"><label htmlFor="library-selection">내 서재</label><select id="library-selection" aria-label="서재 책 선택" value={library.selectedId} onChange={(event) => library.onSelect(event.target.value)}>{library.entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</select><button onClick={library.onOpen}>＋ 소설 URL 추가 · 파일 / 7장 목차</button></div>}
    <div className="book-info"><div className="book-monogram" aria-hidden="true">Re<span>:</span></div><span className="eyebrow">MY LIBRARY</span><h2>{book.title}</h2><p>{book.id.startsWith('novel-') || book.id.startsWith('file-') ? '개인 서재 · 원문 / AI 번역' : '개인 서재 · 샘플 에디션'}</p></div>
    <div className="sidebar-tabs" role="tablist" aria-label="서재 탐색">
      <button role="tab" id="contents-tab" aria-controls="contents-panel" aria-selected={tab === 'contents'} onClick={() => setTab('contents')}>목차 <span>{book.chapters.length}</span></button>
      <button role="tab" id="bookmarks-tab" aria-controls="bookmarks-panel" aria-selected={tab === 'bookmarks'} onClick={() => setTab('bookmarks')}>북마크 <span>{bookmarks.length}</span></button>
    </div>
    <div className="chapter-list" role="tabpanel" id={`${tab}-panel`} aria-labelledby={`${tab}-tab`}>
      {tab === 'contents' ? book.arcs.map((arc) => <section className="arc" key={arc.id}>
        <button className="arc-toggle" aria-expanded={!collapsed.includes(arc.id)} onClick={() => setCollapsed((current) => current.includes(arc.id) ? current.filter((id) => id !== arc.id) : [...current, arc.id])}><span>{arc.title}<small>{arc.subtitle}</small></span><ChevronDown size={14} className={collapsed.includes(arc.id) ? 'collapsed' : ''} /></button>
        {!collapsed.includes(arc.id) && book.chapters.filter((chapter) => chapter.arcId === arc.id).map((chapter) => {
          const state = chapterStates[chapter.id];
          return <div className="toc-entry" key={chapter.id}><button className={`chapter-link ${chapter.id === chapterId ? 'active' : ''}`} aria-current={chapter.id === chapterId ? 'page' : undefined} onClick={() => onNavigate(chapter.id)}><span className="chapter-number">{String(chapter.number).padStart(2, '0')}</span><span>{chapter.title}{state && <small className="chapter-status">{state.translated ? '번역 완료' : '미번역'} · {state.read ? '읽음' : '안 읽음'}</small>}</span>{chapter.id === chapterId && <span className="reading-dot" />}</button>{state?.url && <a className="toc-source" href={state.url} target="_blank" rel="noopener noreferrer" aria-label={`${chapter.number}화 원본 열기`}>↗</a>}</div>;
        })}
      </section>) : bookmarks.length ? bookmarks.map((bookmark) => {
        const chapter = book.chapters.find((item) => item.id === bookmark.chapterId);
        if (!chapter || !chapter.paragraphs.some((item) => item.id === bookmark.paragraphId)) return null;
        return <div className="bookmark-entry" key={bookmark.id}><button className="bookmark-jump" onClick={() => onNavigate(bookmark.chapterId, bookmark.paragraphId)}><small>{chapter.number}화 · {chapter.title}</small><p>{bookmark.excerpt}</p></button><button className="icon-button remove-bookmark" aria-label={`${chapter.number}화 북마크 삭제`} onClick={() => onRemoveBookmark(bookmark)}><Trash2 size={14} /></button></div>;
      }) : <div className="empty-bookmarks"><BookmarkIcon size={26} strokeWidth={1.3} /><p>다시 읽고 싶은 문장을<br />북마크에 담아보세요.</p><small>문단 옆 책갈피를 눌러 저장해요.</small></div>}
    </div>
    <div className="sidebar-note"><Check size={13} /><span>나만의 속도로, 한 페이지씩.</span></div>
  </>;
}
