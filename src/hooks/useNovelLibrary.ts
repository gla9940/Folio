import { useEffect, useRef, useState } from 'react';
import type { Book } from '../domain/models';
import { novelCache } from '../services/novelCache';
import type { ImportedNovel } from '../../shared/novels';
import { libraryId, libraryTitle } from '../domain/library';

export function novelBook(novel: ImportedNovel): Book {
  return {
    id: novel.id, title: novel.title, subtitle: novel.source.attribution, author: novel.collection?.author ?? 'Tappei Nagatsuki',
    arcs: [{ id: `arc-${novel.source.arc}`, title: novel.collection ? '전체 목차' : `제${novel.source.arc}장`, subtitle: novel.collection?.title ?? 'Witch Cult Translations' }],
    chapters: [{ id: novel.chapterId, arcId: `arc-${novel.source.arc}`, number: novel.source.chapter, title: novel.title, paragraphs: novel.paragraphs }],
  };
}
export function useNovelLibrary() {
  const [entries, setEntries] = useState<ImportedNovel[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [readChapters, setReadChapters] = useState<Record<string, boolean>>({});
  const readRef = useRef<Record<string, boolean>>({});
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const selected = entries.find((entry) => entry.id === selectedId);
  const group = selected?.collection;
  const members = group ? entries.filter((entry) => entry.collection?.id === group.id).sort((a, b) => a.collection!.order - b.collection!.order) : selected ? [selected] : [];
  const book = selected ? {
    ...novelBook(selected), id: libraryId(selected), title: titles[libraryId(selected)] ?? libraryTitle(selected),
    chapters: members.flatMap((entry) => novelBook(entry).chapters),
  } : null;
  const books = entries.filter((entry, index) => entries.findIndex((other) => libraryId(other) === libraryId(entry)) === index).map((entry) => ({ id: libraryId(entry), title: titles[libraryId(entry)] ?? libraryTitle(entry) }));
  const selectionId = group?.id ?? selectedId;
  const revision = members.map((entry) => `${entry.id}:${entry.source.hash}`).join('|');
  function status(entry: ImportedNovel) { return { read: !!readChapters[`${entry.id}:${entry.source.hash}`] }; }

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const novels = await novelCache.list();
        const savedId = await novelCache.preference<string>('selected');
        const savedRead = await novelCache.preference<Record<string, boolean>>('read-chapters') ?? {};
        const savedTitles = await novelCache.preference<Record<string, string>>('book-titles') ?? {};
        if (!active) return;
        setEntries(novels);
        setTitles(savedTitles);
        const next = novels.find((novel) => novel.id === savedId || novel.collection?.id === savedId)?.id ?? novels[0]?.id ?? '';
        setSelectedId(next);
        readRef.current = savedRead; setReadChapters(savedRead);
        if (savedId !== next) await novelCache.savePreference('selected', next);
      } catch (problem) { if (active) setError((problem as Error).message); }
      finally { if (active) setReady(true); }
    })();
    return () => { active = false; };
  }, []);

  function select(id: string) {
    const target = entries.find((entry) => entry.id === id) ?? entries.find((entry) => entry.collection?.id === id);
    const next = target?.id ?? id;
    setSelectedId(next); setError('');
    void novelCache.savePreference('selected', next).catch((problem) => setError(problem.message));
  }
  function activateChapter(chapterId: string) {
    const target = entries.find((entry) => entry.chapterId === chapterId);
    if (target && target.id !== selectedId) select(target.id);
  }
  function markRead(chapterId: string) {
    const entry = entries.find((item) => item.chapterId === chapterId);
    if (!entry) return;
    const key = `${entry.id}:${entry.source.hash}`;
    if (readRef.current[key]) return;
    const next = { ...readRef.current, [key]: true };
    readRef.current = next; setReadChapters(next);
    void novelCache.savePreference('read-chapters', next).catch((problem) => setError(problem.message));
  }
  async function addMany(novels: ImportedNovel[]) {
    await novelCache.saveAll(novels);
    const ids = new Set(novels.map((entry) => entry.id));
    setEntries((current) => [...current.filter((entry) => !ids.has(entry.id)), ...novels]);
    select(novels[0].id);
  }
  async function renameBook(id: string, value: string) {
    const title = value.trim();
    if (!title || title.length > 200) throw Error('책 제목은 1~200자로 입력해 주세요.');
    if (!entries.some((entry) => libraryId(entry) === id)) throw Error('책을 찾을 수 없습니다.');
    setTitles(await novelCache.renameBook(id, title));
  }
  async function removeBook(id: string) {
    const targets = entries.filter((entry) => libraryId(entry) === id);
    if (!targets.length) throw Error('책을 찾을 수 없습니다.');
    const fallback = entries.find((entry) => libraryId(entry) !== id)?.id ?? '';
    const keys = [...new Set([id, ...targets.map((entry) => entry.id)])].flatMap((key) => [`folio:v1:progress:${key}`, `folio:v1:bookmarks:${key}`]);
    // Check access before committing the IndexedDB deletion. Never clear storage.
    keys.forEach((key) => window.localStorage.getItem(key));
    const result = await novelCache.removeBook(id, fallback);
    setEntries((current) => current.filter((entry) => libraryId(entry) !== id));
    setTitles(result.titles); readRef.current = result.read; setReadChapters(result.read);
    if (targets.some((entry) => entry.id === selectedId)) setSelectedId(fallback);
    try { keys.forEach((key) => window.localStorage.removeItem(key)); }
    catch { throw Error('책은 삭제됐지만 기기 기록을 정리하지 못했습니다. 브라우저 저장소 설정을 확인해 주세요.'); }
  }
  return { ready, book, selected, selectedId, selectionId, books, members, revision, entries, error, addMany, select, activateChapter, markRead, status, renameBook, removeBook };
}
