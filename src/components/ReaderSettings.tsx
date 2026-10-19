import { AlignJustify, Minus, Moon, Plus, RotateCcw, Sun } from 'lucide-react';
import type { ReaderSettings as Settings, Theme } from '../domain/models';
import { DEFAULT_SETTINGS } from '../services/localReaderStorage';

interface Props { settings: Settings; onChange: (update: Partial<Settings>) => void }
export function ReaderSettings({ settings, onChange }: Props) {
  const themes: { id: Theme; label: string }[] = [{ id: 'light', label: '라이트' }, { id: 'sepia', label: '세피아' }, { id: 'dark', label: '다크' }];
  return <div className="settings-content">
    <section className="setting-group">
      <h3>화면 테마</h3>
      <div className="theme-options">{themes.map(({ id, label }) => <button key={id} className={`theme-option ${settings.theme === id ? 'selected' : ''}`} onClick={() => onChange({ theme: id })} aria-pressed={settings.theme === id}>
        <span className={`theme-swatch ${id}`}>{id === 'dark' ? <Moon size={19} /> : <Sun size={20} />}</span><span>{label}</span>
      </button>)}</div>
    </section>
    <section className="setting-group">
      <h3 id="font-size-label">글자 크기 <span>{settings.fontSize}px</span></h3>
      <div className="stepper"><button aria-label="글자 크기 줄이기" disabled={settings.fontSize <= 14} onClick={() => onChange({ fontSize: settings.fontSize - 1 })}><Minus size={16} /></button><span aria-hidden="true"><span className="small-a">가</span><span className="large-a">가</span></span><button aria-label="글자 크기 늘리기" disabled={settings.fontSize >= 28} onClick={() => onChange({ fontSize: settings.fontSize + 1 })}><Plus size={16} /></button></div>
    </section>
    <section className="setting-group">
      <h3><label htmlFor="line-height">줄 간격</label><span>{settings.lineHeight.toFixed(1)}</span></h3>
      <input id="line-height" type="range" min="1.4" max="2.6" step="0.1" value={settings.lineHeight} onChange={(event) => onChange({ lineHeight: Number(event.target.value) })} />
      <div className="range-labels"><span>좁게</span><span>넓게</span></div>
    </section>
    <section className="setting-group">
      <h3><label htmlFor="content-width">본문 너비</label><span>{settings.contentWidth}px</span></h3>
      <input id="content-width" type="range" min="480" max="840" step="20" value={settings.contentWidth} onChange={(event) => onChange({ contentWidth: Number(event.target.value) })} />
      <div className="range-labels"><span>좁게</span><span>넓게</span></div>
    </section>
    <div className="type-preview" aria-hidden="true"><AlignJustify size={16} /><span>이야기에 머무는 시간</span></div>
    <button className="reset-settings" onClick={() => onChange({ ...DEFAULT_SETTINGS })}><RotateCcw size={13} />기본 설정으로</button>
    <p className="settings-footnote">편안한 독서 환경을 찾아보세요.<br />설정은 이 기기에 자동으로 저장돼요.</p>
  </div>;
}
