import { Bookmark } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { Bookmark as BookmarkModel, Chapter, ReaderSettings, ReadingAnchor, ReadingProgress } from '../domain/models';
import { firstCharacterAt, textRange } from '../domain/readingPosition';

export interface PageState { index: number; total: number }
export interface PageController { turn: (direction: -1 | 1) => void }
interface Props {
  chapter: Chapter;
  settings: ReaderSettings;
  bookmarks: BookmarkModel[];
  heading: ReactNode;
  ending: ReactNode;
  positionRequest: ReadingProgress | null;
  disabled: boolean;
  onBookmark: (id: string) => void;
  onToggleMenus: () => void;
  onPageState: (state: PageState) => void;
  onPosition: (anchor: ReadingAnchor, percent: number) => void;
}
const GAP = 48;

export const PaginatedChapter = forwardRef<PageController, Props>(function PaginatedChapter(props, ref) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const anchor = useRef<ReadingAnchor>({ paragraphId: null, characterOffset: 0 });
  const page = useRef({ index: 0, total: 1, stride: 1, left: 0, width: 1 });
  const anchors = useRef<ReadingAnchor[]>([]);
  const blocks = useRef<{ element: HTMLElement; rects: DOMRect[]; buttons: { element: HTMLButtonElement; rect: DOMRect }[] }[]>([]);
  const touch = useRef<{ x: number; y: number; time: number } | null>(null);
  const turnRef = useRef<(direction: -1 | 1) => void>(() => {});

  function showPage(index: number, animate: boolean, keepAnchor = false) {
    const current = page.current;
    const target = Math.max(0, Math.min(current.total - 1, index));
    current.index = target;
    const track = trackRef.current!;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    track.style.transition = animate && !reduced ? 'transform 220ms cubic-bezier(.2,.65,.3,1)' : 'none';
    track.style.transform = `translate3d(${-target * current.stride}px, 0, 0)`;
    const left = current.left + target * current.stride;
    const intersects = (rect: DOMRect) => rect.right > left + 0.5 && rect.left < left + current.width - 0.5;
    for (const block of blocks.current) {
      const visible = block.rects.some(intersects);
      block.element.inert = !visible;
      block.element.setAttribute('aria-hidden', String(!visible));
      for (const button of block.buttons) button.element.tabIndex = intersects(button.rect) ? 0 : -1;
    }
    if (!keepAnchor) anchor.current = anchors.current[target] ?? { paragraphId: null, characterOffset: 0 };
    latest.current.onPageState({ index: target, total: current.total });
    latest.current.onPosition(anchor.current, current.total > 1 ? Math.round(target / (current.total - 1) * 100) : 100);
  }

  turnRef.current = (direction) => {
    if (latest.current.disabled || window.getSelection()?.toString()) return;
    const index = page.current.index + direction;
    if (index < 0 || index >= page.current.total) return;
    showPage(index, true);
  };
  useImperativeHandle(ref, () => ({ turn: (direction) => turnRef.current(direction) }), []);

  function tapAt(clientX: number) {
    if (props.disabled || window.getSelection()?.toString() || !window.matchMedia('(max-width: 759px)').matches) return;
    const bounds = viewportRef.current!.getBoundingClientRect();
    const fraction = (clientX - bounds.left) / bounds.width;
    if (fraction < .25) turnRef.current(-1);
    else if (fraction > .75) turnRef.current(1);
    else props.onToggleMenus();
  }

  useLayoutEffect(() => {
    const request = props.positionRequest;
    anchor.current = request?.chapterId === props.chapter.id
      ? { paragraphId: request.paragraphId, characterOffset: request.characterOffset ?? 0, ...(request.atChapterEnd ? { atChapterEnd: true } : {}) }
      : { paragraphId: null, characterOffset: 0 };
  }, [props.positionRequest, props.chapter.id]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current!;
    const track = trackRef.current!;
    let cancelled = false;
    let frame = 0;
    const layout = () => {
      if (cancelled || !viewport.clientWidth || !viewport.clientHeight) return;
      const width = Math.floor(viewport.clientWidth);
      const lineHeight = parseFloat(getComputedStyle(track).lineHeight);
      // Whole line boxes prevent the last line from being sliced by the viewport.
      const height = Math.max(lineHeight, Math.floor((viewport.clientHeight - 4) / lineHeight) * lineHeight);
      track.style.transition = 'none';
      track.style.transform = 'none';
      track.style.width = `${width}px`;
      track.style.height = `${height}px`;
      track.style.columnWidth = `${width}px`;
      const bounds = viewport.getBoundingClientRect();
      const stride = width + GAP;
      const total = Math.max(1, Math.round((track.scrollWidth + GAP) / stride));
      page.current = { index: page.current.index, total, width, stride, left: bounds.left };

      // Measure once per reflow; page turns only transform the already laid out text.
      blocks.current = Array.from(track.querySelectorAll<HTMLElement>('[data-page-block]')).map((element) => {
        const range = document.createRange();
        range.selectNodeContents(element.querySelector('[data-paragraph-text]') ?? element);
        return {
          element, rects: Array.from(range.getClientRects()),
          buttons: Array.from(element.querySelectorAll<HTMLButtonElement>('button')).map((button) => ({ element: button, rect: button.getBoundingClientRect() })),
        };
      });
      const paragraphs = blocks.current.filter((block) => block.element.hasAttribute('data-paragraph'));
      anchors.current = Array.from({ length: total }, (_, index) => {
        const left = bounds.left + index * stride;
        const block = paragraphs.find((item) => item.rects.some((rect) => rect.right > left + .5 && rect.left < left + width - .5));
        if (block) return { paragraphId: block.element.id, characterOffset: firstCharacterAt(block.element, (rect) => rect.right <= left + .5) };
        if (index === 0) return { paragraphId: null, characterOffset: 0 };
        const last = latest.current.chapter.paragraphs.at(-1)!;
        return { paragraphId: last.id, characterOffset: Math.max(0, last.text.length - 1), atChapterEnd: true };
      });
      const target = anchor.current.paragraphId ? document.getElementById(anchor.current.paragraphId) : null;
      const rect = target ? textRange(target, anchor.current.characterOffset)?.getBoundingClientRect() : null;
      const index = anchor.current.atChapterEnd ? total - 1 : rect ? Math.floor((rect.left - bounds.left + .5) / stride) : 0;
      showPage(index, false, true);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      void document.fonts.ready.then(() => {
        if (!cancelled) frame = requestAnimationFrame(layout);
      });
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(viewport);
    document.fonts.addEventListener('loadingdone', schedule);
    schedule();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.fonts.removeEventListener('loadingdone', schedule);
    };
  }, [props.chapter.id, props.settings.fontSize, props.settings.lineHeight, props.settings.contentWidth, props.positionRequest]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || latest.current.disabled) return;
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        turnRef.current(event.key === 'ArrowLeft' ? -1 : 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return <article className="paged-reader" aria-label={`${props.chapter.number}화 ${props.chapter.title}`}>
    <div ref={viewportRef} id="reader-text" className="page-viewport" tabIndex={-1}
      onTouchStart={(event) => {
        if (event.touches.length !== 1 || (event.target as HTMLElement).closest('button, a, input')) { touch.current = null; return; }
        touch.current = { x: event.touches[0].clientX, y: event.touches[0].clientY, time: Date.now() };
      }}
      onTouchEnd={(event) => {
        const start = touch.current;
        touch.current = null;
        if (!start || event.changedTouches.length !== 1) return;
        const dx = event.changedTouches[0].clientX - start.x;
        const dy = event.changedTouches[0].clientY - start.y;
        if (Math.abs(dx) >= 45 && Math.abs(dx) > Math.abs(dy) * 1.4 && Date.now() - start.time < 1200) {
          event.preventDefault();
          turnRef.current(dx < 0 ? 1 : -1);
        } else if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && Date.now() - start.time < 500 && window.matchMedia('(max-width: 759px)').matches) {
          event.preventDefault();
          tapAt(event.changedTouches[0].clientX);
        }
      }}
      onTouchCancel={() => { touch.current = null; }}
      onClick={(event) => {
        if (props.disabled || (event.target as HTMLElement).closest('button, a, input') || window.getSelection()?.toString()) return;
        tapAt(event.clientX);
      }}>
      <div ref={trackRef} className="page-track reader-text" style={{ columnGap: GAP }}>
        <div data-page-block>{props.heading}</div>
        {props.chapter.paragraphs.map((paragraph, index) => {
          const saved = props.bookmarks.some((bookmark) => bookmark.chapterId === props.chapter.id && bookmark.paragraphId === paragraph.id);
          return <p id={paragraph.id} key={paragraph.id} data-paragraph data-page-block className={`paged-paragraph ${saved ? 'is-bookmarked' : ''}`}>
            <button className="paragraph-bookmark" aria-label={`문단 ${index + 1} 북마크 ${saved ? '해제' : '저장'}`} aria-pressed={saved} onClick={() => props.onBookmark(paragraph.id)}><Bookmark size={14} fill={saved ? 'currentColor' : 'none'} strokeWidth={1.5} /></button><span data-paragraph-text>{paragraph.text}</span>
          </p>;
        })}
        <div className="paged-ending" data-page-block>{props.ending}</div>
      </div>
    </div>
  </article>;
});
