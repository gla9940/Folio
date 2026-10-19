import { useEffect, useRef, useState } from 'react';
import { sampleBook, SAMPLE_BOOK_ID } from '../data/sampleBook';
import type { Book } from '../domain/models';
import { novelCache } from '../services/novelCache';
import type { ImportedNovel } from '../../shared/novels';

export function novelBook(novel: ImportedNovel): Book {
  return {
    id: novel.id, title: novel.title, subtitle: novel.source.attribution, author: novel.collection?.author ?? 'Tappei Nagatsuki',
    arcs: [{ id: `arc-${novel.source.arc}`, title: novel.collection ? '전체 목차' : `제${novel.source.arc}장`, subtitle: novel.collection?.title ?? 'Witch Cult Translations' }],
    chapters: [{ id: novel.chapterId, arcId: `arc-${novel.source.arc}`, number: novel.source.chapter, title: novel.title, paragraphs: novel.paragraphs }],
  };
}
export function useNovelLibrary() {
  const [entries, setEntries] = useState<ImportedNovel[]>([]);
  const [selectedId, setSelectedId] = useState(SAMPLE_BOOK_ID);
  const [readChapters, setReadChapters] = useState<Record<string, boolean>>({});
  const readRef = useRef<Record<string, boolean>>({});
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const selected = entries.find((entry) => entry.id === selectedId);
  const group = selected?.collection;
  const members = group ? entries.filter((entry) => entry.collection?.id === group.id).sort((a, b) => a.collection!.order - b.collection!.order) : selected ? [selected] : [];
  const book = selected ? {
    ...novelBook(selected), id: group?.id ?? selected.id, title: group?.title ?? selected.title,
    chapters: members.flatMap((entry) => novelBook(entry).chapters),
  } : sampleBook;
  const books = entries.filter((entry, index) => !entry.collection || entries.findIndex((other) => other.collection?.id === entry.collection!.id) === index).map((entry) => ({ id: entry.collection?.id ?? entry.id, title: entry.collection?.title ?? entry.title }));
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
        if (!active) return;
        setEntries(novels);
        if (savedId && novels.some((novel) => novel.id === savedId)) setSelectedId(savedId);
        readRef.current = savedRead; setReadChapters(savedRead);
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
  return { ready, book, selected, selectedId, selectionId, books, members, revision, entries, error, addMany, select, activateChapter, markRead, status };
}
