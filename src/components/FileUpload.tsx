import { useState } from 'react';
import { fileNovels, previewFile } from '../services/fileImport';
import type { FilePreview } from '../services/fileImport';
import type { ImportedNovel } from '../../shared/novels';

export function FileUpload({ onImport, busy, perform }: { onImport: (novels: ImportedNovel[]) => Promise<void>; busy: boolean; perform: (work: () => Promise<void>) => Promise<void> }) {
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [title, setTitle] = useState('');
  const [encoding, setEncoding] = useState('utf-8');
  const [file, setFile] = useState<File | null>(null);
  async function analyze(chosen: File, charset: string) {
    setPreview(null);
    await perform(async () => { const value = await previewFile(chosen, charset); setTitle(value.title.slice(0, 200)); setPreview(value); });
  }
  return <section className="file-upload" aria-label="파일 등록">
    <p className="field-note">개인 열람이 허용된 EPUB/TXT를 선택하세요. 파일은 서버에 업로드되지 않으며 이 브라우저에서 분석·저장됩니다.</p>
    <label htmlFor="text-encoding">TXT 인코딩</label><select id="text-encoding" value={encoding} disabled={busy} onChange={(event) => { setEncoding(event.target.value); if (file) void analyze(file, event.target.value); }}><option value="utf-8">UTF-8</option><option value="utf-16le">UTF-16 LE</option><option value="utf-16be">UTF-16 BE</option><option value="euc-kr">EUC-KR</option></select>
    <label htmlFor="novel-file">EPUB / TXT 파일 (최대 20MB)</label><input id="novel-file" type="file" accept=".epub,.txt,application/epub+zip,text/plain" disabled={busy} onChange={(event) => { const chosen = event.target.files?.[0]; setFile(chosen ?? null); setPreview(null); if (chosen) void analyze(chosen, encoding); }} />
    {preview && <form onSubmit={(event) => { event.preventDefault(); void perform(async () => { await onImport(await fileNovels(preview, title)); }); }}>
      <label htmlFor="file-book-title">책 제목</label><input id="file-book-title" value={title} maxLength={200} required onChange={(event) => setTitle(event.target.value)} />
      <p className="file-summary" role="status">{preview.author} · {preview.chapters.length}개 화 · {preview.chapters.reduce((sum, entry) => sum + entry.texts.length, 0).toLocaleString()}문단</p>
      <ol className="file-preview" aria-label="등록할 목차">{preview.chapters.map((entry, index) => <li key={entry.key}><span>{String(index + 1).padStart(2, '0')} · {entry.title}</span><small>{entry.texts.length}문단</small></li>)}</ol>
      <button className="text-action" disabled={busy}>{busy ? '저장 중…' : `${preview.chapters.length}개 화 서재에 등록`}</button>
    </form>}
    <p className="field-note">EPUB 2/3의 읽기 순서·목차를 지원합니다. DRM 파일은 열지 않습니다. TXT는 Chapter / 제N화 / 제N장 제목으로 나누며, 제목이 없으면 한 화로 등록합니다. 빈 줄과 대사 안 줄바꿈을 유지합니다.</p>
  </section>;
}
