import type { useNovelLibrary } from '../hooks/useNovelLibrary';
import { makeBatches } from '../../shared/novels';
import { useEffect, useState } from 'react';
type Library = ReturnType<typeof useNovelLibrary>;
export function NovelControls({ library, onLanguage, onLogin }: { library: Library; onLanguage: (language: 'en' | 'ko') => void; onLogin: () => void }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { if (library.retryAt <= Date.now()) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [library.retryAt]);
  if (!library.selected) return null;
  const coolingDown = library.retryAt > now;
  const completed = library.cache?.chunks.filter((chunk) => chunk.status === 'complete').length ?? 0;
  const total = library.cache?.chunks.length ?? makeBatches(library.selected.paragraphs).length;
  const failed = library.cache?.chunks.some((chunk) => chunk.status === 'error');
  return <section className="novel-controls" aria-label="원문 및 번역">
    <div className="novel-control-row"><div className="language-options" role="group" aria-label="본문 언어"><button aria-pressed={library.language === 'en'} onClick={() => onLanguage('en')}>원문 보기</button><button aria-pressed={library.language === 'ko'} disabled={!library.complete} onClick={() => onLanguage('ko')}>한국어</button></div>
      {library.selected.source.url.startsWith('https://') ? <a href={library.selected.source.url} target="_blank" rel="noopener noreferrer">원본 출처 ↗</a> : <span className="file-source">{library.selected.source.kind.toUpperCase()} · 기기 저장</span>}
      {library.running ? <button onClick={library.stop}>번역 중단</button> : !library.complete && <button className="translate-action" disabled={library.requestBlocked || coolingDown} onClick={() => library.session.authenticated ? void library.translate() : onLogin()}>{library.requestBlocked ? '요청 수정 필요' : coolingDown ? '잠시 후 재시도' : failed ? '번역 재시도' : completed ? '이어서 번역' : '번역하기'}</button>}
      {library.complete && <span className="translation-done">번역 저장됨</span>}
    </div>
    <div className="translation-progress"><progress aria-label="번역 진행률" value={completed} max={total} /><span>{completed} / {total} 구간{library.waiting ? ' · 무료 한도 보호 대기 중' : library.running ? ' · 번역 중' : library.complete ? ' · 완료' : ''}</span></div>
    {library.error && <p className="translation-error" role="alert">{library.error}{coolingDown ? ` (재시도 가능 시각: ${new Date(library.retryAt).toLocaleTimeString('ko-KR')})` : ''}</p>}
  </section>;
}
