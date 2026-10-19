import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { ArrowLeft, ArrowRight, Bookmark, BookOpen, Check, ChevronLeft, ChevronRight, CloudOff, List, SlidersHorizontal } from 'lucide-react';
import type { Bookmark as BookmarkModel } from './domain/models';
import { sampleBook, SAMPLE_BOOK_ID } from './data/sampleBook';
import { createLocalReaderStorage } from './services/localReaderStorage';
import { useReader } from './hooks/useReader';
import { Contents } from './components/Contents';
import { ReaderSettings } from './components/ReaderSettings';
import { SidePanel } from './components/SidePanel';
import { PaginatedChapter } from './components/PaginatedChapter';
import type { PageController, PageState } from './components/PaginatedChapter';
import { useVisualViewport } from './hooks/useVisualViewport';
import { novelBook, useNovelLibrary } from './hooks/useNovelLibrary';
import { LibraryDialog } from './components/LibraryDialog';
import { NovelControls } from './components/NovelControls';

const storage = createLocalReaderStorage();

export function App() {
  const library = useNovelLibrary();
  if (!library.ready) return <main className="loading-state"><span className="wordmark">Folio<span>.</span></span><p>이야기를 펼치고 있어요.</p></main>;
  return <Reader key={`${library.book.id}:${library.selected?.source.hash ?? 'sample'}`} library={library} />;
}

function Reader({ library }: { library: ReturnType<typeof useNovelLibrary> }) {
  const book = library.book;
  const reader = useReader(book, storage);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [panel, setPanel] = useState<'contents' | 'settings' | null>(null);
  const [tab, setTab] = useState<'contents' | 'bookmarks'>('contents');
  const [menusVisible, setMenusVisible] = useState(true);
  const [announcement, setAnnouncement] = useState('');
  const closePanel = useCallback(() => setPanel(null), []);
  const openLibrary = () => { closePanel(); setLibraryOpen(true); };
  const { chapter, chapterIndex, settings, bookmarks } = reader;
  const paged = settings.readingMode === 'paged';
  const pageController = useRef<PageController>(null);
  const [pageState, setPageState] = useState<PageState>({ index: 0, total: 1 });
  useVisualViewport(paged);
  const arc = book.arcs.find((item) => item.id === chapter.arcId)!;
  const previous = book.chapters[chapterIndex - 1];
  const next = book.chapters[chapterIndex + 1];

  useEffect(() => { document.title = `${chapter.title} · Folio`; }, [chapter.title]);
  useEffect(() => {
    if (!announcement) return;
    const timer = setTimeout(() => setAnnouncement(''), 2400);
    return () => clearTimeout(timer);
  }, [announcement]);
  useEffect(() => {
    const resize = () => { if (window.innerWidth >= 1200 || (window.innerWidth >= 760 && panel === 'contents')) setPanel(null); };
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [panel]);

  function navigate(id: string, paragraphId?: string) { reader.navigate(id, paragraphId); closePanel(); setMenusVisible(true); }
  function toggleBookmark(id: string) { const added = reader.toggleBookmark(id); setAnnouncement(added ? '북마크에 문단을 담았어요.' : '북마크를 삭제했어요.'); }
  function removeBookmark(bookmark: BookmarkModel) {
    reader.removeBookmark(bookmark.id);
    setAnnouncement('북마크를 삭제했어요.');
  }
  const textStyle = { '--reader-font-size': `${settings.fontSize}px`, '--reader-line-height': settings.lineHeight, '--reader-width': `${settings.contentWidth}px` } as CSSProperties;
  const chapterHeading = <header className="chapter-heading"><p className="eyebrow">CHAPTER {String(chapter.number).padStart(2, '0')}</p><h1>{chapter.title}</h1><div className="chapter-metadata"><span>제{chapter.number}화</span><span className="metadata-dot">·</span><span>약 {Math.max(1, Math.ceil(chapter.paragraphs.reduce((sum, item) => sum + item.text.length, 0) / 400))}분 분량</span><span className="demo-label">{library.selected ? library.language === 'ko' ? 'AI · KO' : 'EN' : 'DEMO'}</span></div><span className="chapter-rule" /></header>;
  const chapterEnding = <>
    <div className="chapter-end"><span>✧</span><p>이야기는 다음 페이지로 이어집니다.</p></div>
    <nav className="chapter-navigation" aria-label="본문 하단 화 이동"><button disabled={!previous} onClick={() => previous && navigate(previous.id)}><ArrowLeft size={17} /><span><small>이전 화</small>{previous?.title ?? '첫 번째 이야기'}</span></button><button disabled={!next} onClick={() => next && navigate(next.id)}><span><small>다음 화</small>{next?.title ?? '마지막 이야기'}</span><ArrowRight size={17} /></button></nav>
    {library.selected ? <p className="demo-notice">{library.selected.source.attribution}<br /><a href={library.selected.source.url} target="_blank" rel="noopener noreferrer">원본 출처</a>{library.language === 'ko' ? ' · Gemini AI 번역 (검수되지 않음)' : ' · 영어 원문'}</p> : <p className="demo-notice">이 본문은 뷰어 시연을 위해 작성한 창작 샘플입니다.<br />실제 소설 원문이나 번역문을 포함하지 않습니다.</p>}
  </>;
  return <div className={`reader-app ${paged ? 'paged-mode' : ''} ${menusVisible ? 'menus-visible' : 'menus-hidden'}`} style={textStyle}>
    <a className="skip-link" href="#reader-text">본문으로 건너뛰기</a>
    <header className="topbar" inert={panel !== null}>
      <div className="brand"><BookOpen size={21} strokeWidth={1.5} /><span className="wordmark">Folio<span>.</span></span><span className="brand-divider" /><span className="brand-caption">나만의 작은 서재</span></div>
      <div className="topbar-book">{book.title}<span>{library.selected ? '개인 서재' : '샘플 에디션'}</span></div>
      <div className={`save-state ${reader.storageError ? 'has-error' : ''}`}>{reader.storageError ? <CloudOff size={14} /> : <Check size={14} />}<span>{reader.storageError ? '기기 저장 불가' : '이 기기에 자동 저장'}</span></div>
      <button className="icon-button compact-settings" aria-label="읽기 설정 열기" onClick={() => setPanel('settings')}><SlidersHorizontal size={20} /></button>
    </header>

    <SidePanel side="left" open={panel === 'contents'} title="내 서재" onClose={closePanel}>
      <Contents book={book} chapterId={chapter.id} bookmarks={bookmarks} tab={tab} setTab={setTab} onNavigate={navigate} onRemoveBookmark={removeBookmark} library={{ selectedId: library.selectedId, entries: [{ id: SAMPLE_BOOK_ID, title: `샘플 · ${sampleBook.title}` }, ...library.entries.map((entry) => ({ id: entry.id, title: entry.title }))], onSelect: (id) => { reader.capturePosition(); library.select(id); closePanel(); }, onOpen: openLibrary }} />
    </SidePanel>

    <main className={`reading-main ${paged ? 'paged-main' : ''}`} inert={panel !== null} onClick={(event) => {
      if (!paged || !window.matchMedia('(max-width: 759px)').matches || window.getSelection()?.toString() || (event.target as HTMLElement).closest('button, a, .page-viewport')) return;
      const bounds = document.querySelector('.page-viewport')?.getBoundingClientRect();
      if (!bounds || event.clientY < bounds.top || event.clientY > bounds.bottom) return;
      if (event.clientX < bounds.left) pageController.current?.turn(-1);
      else if (event.clientX > bounds.right) pageController.current?.turn(1);
    }}>
      <div className="reading-context"><span>{arc.title}<ChevronRight size={12} />{arc.subtitle}</span><span>{String(chapterIndex + 1).padStart(2, '0')} <span className="muted">/ {String(book.chapters.length).padStart(2, '0')}</span></span></div>
      <NovelControls library={library} onLogin={openLibrary} onLanguage={(language) => { if (library.selected && language !== library.language) { reader.prepareContentChange(novelBook(library.selected, library.cache, language).chapters[0].paragraphs); library.setLanguage(language); } }} />
      {paged ? <PaginatedChapter key={chapter.id} ref={pageController} chapter={chapter} settings={settings} bookmarks={bookmarks} heading={chapterHeading} ending={chapterEnding} positionRequest={reader.positionRequest} disabled={panel !== null || libraryOpen} onBookmark={toggleBookmark} onToggleMenus={() => setMenusVisible((current) => !current)} onPageState={setPageState} onPosition={reader.savePagePosition} /> : <article className="chapter-body" aria-label={`${chapter.number}화 ${chapter.title}`} onClick={(event) => {
        if (window.matchMedia('(max-width: 759px)').matches && !window.getSelection()?.toString() && !(event.target as HTMLElement).closest('button, a')) setMenusVisible((current) => !current);
      }}>
        {chapterHeading}
        <div id="reader-text" className="reader-text" tabIndex={-1}>{chapter.paragraphs.map((paragraph) => {
          const saved = bookmarks.some((item) => item.chapterId === chapter.id && item.paragraphId === paragraph.id);
          return <div className={`paragraph ${saved ? 'is-bookmarked' : ''}`} key={paragraph.id} id={paragraph.id} data-paragraph>
            <p>{paragraph.text}</p><button className="paragraph-bookmark" aria-label={`문단 ${chapter.paragraphs.indexOf(paragraph) + 1} 북마크 ${saved ? '해제' : '저장'}`} aria-pressed={saved} onClick={(event) => { event.stopPropagation(); toggleBookmark(paragraph.id); }}><Bookmark size={16} fill={saved ? 'currentColor' : 'none'} strokeWidth={1.5} /></button>
          </div>;
        })}</div>
        {chapterEnding}
      </article>}
    </main>

    <SidePanel side="right" open={panel === 'settings'} title="읽기 설정" onClose={closePanel}><ReaderSettings settings={settings} onChange={reader.updateSettings} /></SidePanel>

    <footer className="reader-toolbar" inert={panel !== null}>
      <div className="toolbar-progress" style={{ width: `${reader.percent}%` }} />
      <button className="toolbar-contents" aria-label="목차 열기" onClick={() => { setTab('contents'); setPanel('contents'); }}><List size={19} /><span>목차</span></button>
      {paged && <nav className="page-navigation" aria-label="페이지 이동"><button className="icon-button" aria-label="이전 페이지" disabled={pageState.index === 0} onClick={() => pageController.current?.turn(-1)}><ChevronLeft size={20} /></button><span className="page-count" aria-label="현재 페이지 / 전체 페이지" aria-live="polite">{pageState.index + 1} <span>/ {pageState.total}</span></span><button className="icon-button" aria-label="다음 페이지" disabled={pageState.index >= pageState.total - 1} onClick={() => pageController.current?.turn(1)}><ChevronRight size={20} /></button></nav>}
      <div className="toolbar-chapters"><button className="icon-button" aria-label="이전 화" disabled={!previous} onClick={() => previous && navigate(previous.id)}><ChevronLeft size={20} /></button><span>{chapter.number}화 <span className="toolbar-title">· {chapter.title}</span></span><button className="icon-button" aria-label="다음 화" disabled={!next} onClick={() => next && navigate(next.id)}><ChevronRight size={20} /></button></div>
      <span className="reading-percent" aria-label="현재 화 읽기 진행률">{reader.percent}<small>%</small></span>
      <button className="mobile-settings icon-button" aria-label="읽기 설정" onClick={() => setPanel('settings')}><SlidersHorizontal size={19} /></button>
    </footer>
    {paged && <div className="page-position-hint">{pageState.index + 1} / {pageState.total}<span>·</span>{reader.percent}%</div>}
    {!menusVisible && <button className="show-menus" aria-label="독서 메뉴 표시" onClick={() => setMenusVisible(true)}><List size={16} /></button>}
    <div className={`toast ${announcement ? 'visible' : ''}`} role="status">{announcement}</div>
    {reader.storageError && <div className="storage-warning" role="alert">기기 저장 공간 또는 브라우저 설정을 확인해 주세요. 현재 변경 사항은 새로고침하면 사라질 수 있어요.</div>}
    {!library.selected && library.error && <div className="library-storage-error" role="alert">{library.error}</div>}
    {libraryOpen && <LibraryDialog library={library} onClose={() => setLibraryOpen(false)} />}
  </div>;
}
