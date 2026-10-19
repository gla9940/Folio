// DOM Range uses UTF-16 offsets. Keep the original text untouched, including dialogue and whitespace.
export function textRange(element: Element, offset = 0): Range | null {
  const text = element.querySelector('[data-paragraph-text]') ?? element.querySelector('p') ?? element;
  const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  let remaining = Math.max(0, offset);
  while (node) {
    const length = node.textContent?.length ?? 0;
    if (remaining < length) {
      const range = document.createRange();
      const start = Math.min(remaining, Math.max(0, length - 1));
      range.setStart(node, start);
      range.setEnd(node, Math.min(start + 1, length));
      return range;
    }
    remaining -= length;
    const next = walker.nextNode();
    if (!next) {
      const range = document.createRange();
      range.setStart(node, Math.max(0, length - 1));
      range.setEnd(node, length);
      return range;
    }
    node = next;
  }
  return null;
}

export function firstCharacterAt(element: Element, isBefore: (rect: DOMRect) => boolean): number {
  const text = element.querySelector('[data-paragraph-text]') ?? element.querySelector('p') ?? element;
  let low = 0;
  let high = Math.max(0, (text.textContent?.length ?? 0) - 1);
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const rect = textRange(element, mid)?.getBoundingClientRect();
    if (rect && isBefore(rect)) low = mid + 1;
    else high = mid;
  }
  return low;
}
