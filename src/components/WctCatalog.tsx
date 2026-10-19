import { useState } from 'react';
import catalog from '../data/wctArc7.json';
import type { useNovelLibrary } from '../hooks/useNovelLibrary';
export type CatalogChapter = typeof catalog.chapters[number];
export function WctCatalog({ library, onPrepare, onRead }: { library: ReturnType<typeof useNovelLibrary>; onPrepare: (entry: CatalogChapter) => void; onRead: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const chapters = catalog.chapters.filter((entry) => `${entry.number} ${entry.title}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <section className="wct-catalog" aria-label="WCT 7장 목차">
    <p className="field-note"><a href={catalog.source} target="_blank" rel="noopener noreferrer">Witch Cult Translations 공식 목차 ↗</a><br />{catalog.checkedAt} 확인 · {catalog.chapters.length}개 항목 · 제목과 링크만 제공하며 본문은 일괄 수집하지 않습니다.</p>
    <label htmlFor="catalog-search">화 번호 또는 제목 검색</label><input id="catalog-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="예: 2 Animal Tracking" />
    <ol className="catalog-list">{chapters.map((entry) => {
      const novel = library.entries.find((item) => item.source.url === entry.url);
      const state = novel && library.status(novel);
      return <li key={entry.url}><span className="catalog-number">{entry.number}</span><div><span className="catalog-title">{entry.title}</span><small className="chapter-status">{state ? `${state.translated ? '번역 완료' : '미번역'} · ${state.read ? '읽음' : '안 읽음'}` : '본문 미등록 · 미번역'}</small><div className="catalog-actions"><a href={entry.url} target="_blank" rel="noopener noreferrer" aria-label={`${entry.number}화 원본 페이지 열기`}>원본 열기 ↗</a>{novel ? <button onClick={() => onRead(novel.id)}>Folio에서 읽기</button> : <button onClick={() => onPrepare(entry)}>등록 준비</button>}</div></div></li>;
    })}</ol>
    {!chapters.length && <p className="field-note">일치하는 화가 없습니다.</p>}
    <p className="field-note">자동 가져오기는 운영자의 이용 조건·허가 확인 후에만 활성화됩니다. 불가능한 화는 허용된 EPUB/TXT로 등록하세요. 원본의 번호·링크 표기는 수정하지 않고 유지합니다.</p>
  </section>;
}
