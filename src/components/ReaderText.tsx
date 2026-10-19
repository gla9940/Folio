import { useLayoutEffect, useRef } from 'react';

/** Browser translation owns descendants; React only owns this stable boundary. */
export function ReaderText({ text, paragraph = false }: { text: string; paragraph?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => { ref.current!.textContent = text; }, [text]);
  return <span ref={ref} data-reader-text data-paragraph-text={paragraph || undefined} data-source-length={text.length} translate="yes" />;
}
