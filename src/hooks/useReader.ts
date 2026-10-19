import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Book, Bookmark, ReaderSettings, ReadingProgress, ReadingAnchor } from '../domain/models';
import { firstCharacterAt, textRange } from '../domain/readingPosition';
import type { ReaderStorage } from '../services/contracts';

export function useReader(book: Book, storage: ReaderStorage) {
  const [settings, setSettings] = useState(() => storage.getSettings());
  const [bookmarks, setBookmarks] = useState(() => storage.getBookmarks(book.id));
  const [initialProgress] = useState(() => storage.getProgress(book.id));
  const [chapterId, setChapterId] = useState(() => {
    return book.chapters.find((item) => item.id === initialProgress?.chapterId)?.id ?? book.chapters[0].id;
  });
  const [percent, setPercent] = useState(0);
  const [storageError, setStorageError] = useState(false);
  const pendingPosition = useRef<ReadingProgress | null>(initialProgress);
  const latestPosition = useRef<ReadingProgress | null>(initialProgress);
  const [positionRequest, setPositionRequest] = useState(initialProgress);
  const restoreByCharacter = useRef(initialProgress?.readingMode === 'paged');
  const ready = useRef(false);
  const chapter = book.chapters.find((item) => item.id === chapterId)!;
  const chapterIndex = book.chapters.indexOf(chapter);
  const report = useCallback((success: boolean) => { if (!success) setStorageError(true); }, []);

  const savePosition = useCallback(() => {
    if (!ready.current || settings.readingMode === 'paged') return;
    const paragraphs = Array.from(document.querySelectorAll<HTMLElement>('[data-paragraph]'));
    const anchor = paragraphs.find((element) => element.getBoundingClientRect().bottom > 100);
    const progress: ReadingProgress = {
      bookId: book.id, chapterId, scrollY: window.scrollY,
      paragraphId: anchor?.id ?? null,
      paragraphOffset: anchor?.getBoundingClientRect().top ?? 0,
      characterOffset: anchor ? firstCharacterAt(anchor, (rect) => rect.bottom <= 100) : 0,
      readingMode: 'scroll',
      updatedAt: new Date().toISOString(),
    };
    latestPosition.current = progress;
    report(storage.saveProgress(progress));
  }, [book.id, chapterId, report, storage, settings.readingMode]);

  const savePagePosition = useCallback((anchor: ReadingAnchor, progressPercent: number) => {
    const progress: ReadingProgress = {
      bookId: book.id, chapterId, ...anchor, paragraphOffset: 120,
      scrollY: 0, readingMode: 'paged', updatedAt: new Date().toISOString(),
    };
    latestPosition.current = progress;
    setPercent(progressPercent);
    report(storage.saveProgress(progress));
  }, [book.id, chapterId, report, storage]);

  useLayoutEffect(() => {
    ready.current = false;
    if (settings.readingMode === 'paged') {
      window.scrollTo({ top: 0, behavior: 'instant' });
      return;
    }
    let cancelled = false;
    let frame = 0;
    void document.fonts.ready.then(() => {
      if (cancelled) return;
      frame = requestAnimationFrame(() => {
        const saved = pendingPosition.current ?? latestPosition.current;
        const anchor = saved?.paragraphId ? document.getElementById(saved.paragraphId) : null;
        const character = anchor && saved ? textRange(anchor, saved.characterOffset ?? 0) : null;
        const top = saved?.chapterId === chapterId
          ? anchor ? window.scrollY + (restoreByCharacter.current && character
            ? character.getBoundingClientRect().top - 120
            : anchor.getBoundingClientRect().top - saved.paragraphOffset) : saved.scrollY
          : 0;
        window.scrollTo({ top, behavior: 'instant' });
        pendingPosition.current = null;
        restoreByCharacter.current = false;
        ready.current = true;
        setPercent(Math.round(window.scrollY / Math.max(1, document.documentElement.scrollHeight - window.innerHeight) * 100));
        savePosition();
      });
    });
    return () => { cancelled = true; cancelAnimationFrame(frame); ready.current = false; };
  }, [chapterId, savePosition, positionRequest, settings.readingMode, settings.fontSize, settings.lineHeight, settings.contentWidth]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      if (settings.readingMode === 'paged' || !ready.current) return;
      setPercent(Math.min(100, Math.round(window.scrollY / Math.max(1, document.documentElement.scrollHeight - window.innerHeight) * 100)));
      clearTimeout(timer);
      timer = setTimeout(savePosition, 180);
    };
    const onResize = () => {
      if (settings.readingMode !== 'scroll' || !ready.current) return;
      pendingPosition.current = latestPosition.current;
      restoreByCharacter.current = true;
      setPositionRequest(latestPosition.current ? { ...latestPosition.current } : null);
    };
    const flush = () => savePosition();
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pagehide', flush);
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [savePosition, settings.readingMode]);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', { sepia: '#f5f1e8', light: '#fcfcfa', dark: '#20231f' }[settings.theme]);
    report(storage.saveSettings(settings));
  }, [settings, report, storage]);

  function updateSettings(update: Partial<ReaderSettings>) {
    if (update.readingMode !== undefined || update.fontSize !== undefined || update.lineHeight !== undefined || update.contentWidth !== undefined) {
      savePosition();
      pendingPosition.current = latestPosition.current;
      restoreByCharacter.current = true;
      setPositionRequest(latestPosition.current);
    }
    setSettings((current) => ({ ...current, ...update }));
  }
  function navigate(id: string, paragraphId?: string) {
    savePosition();
    if (id === chapterId && !paragraphId) return;
    pendingPosition.current = { bookId: book.id, chapterId: id, scrollY: 0, paragraphId: paragraphId ?? null, paragraphOffset: 120, characterOffset: 0, readingMode: settings.readingMode, updatedAt: new Date().toISOString() };
    latestPosition.current = pendingPosition.current;
    restoreByCharacter.current = false;
    setPositionRequest(pendingPosition.current);
    ready.current = false;
    setChapterId(id);
  }
  function toggleBookmark(paragraphId: string) {
    const existing = bookmarks.find((item) => item.chapterId === chapterId && item.paragraphId === paragraphId);
    const next: Bookmark[] = existing ? bookmarks.filter((item) => item.id !== existing.id) : [...bookmarks, {
      id: `${book.id}:${chapterId}:${paragraphId}`, bookId: book.id, chapterId, paragraphId,
      excerpt: chapter.paragraphs.find((item) => item.id === paragraphId)!.text,
      createdAt: new Date().toISOString(),
    }];
    setBookmarks(next);
    report(storage.saveBookmarks(book.id, next));
    return !existing;
  }
  function removeBookmark(id: string) {
    const next = bookmarks.filter((item) => item.id !== id);
    setBookmarks(next);
    report(storage.saveBookmarks(book.id, next));
  }
  return { settings, updateSettings, bookmarks, chapter, chapterIndex, navigate, toggleBookmark, removeBookmark, percent, storageError, positionRequest, savePagePosition };
}
