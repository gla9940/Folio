// Browser translation can replace/wrap text nodes. Measure only rendered text;
// stored UTF-16 offsets remain proportional to the unchanged source paragraph.
function content(element: Element): Element {
  return element.querySelector('[data-paragraph-text]') ?? element.querySelector('p') ?? element;
}
function nodesOf(element: Element): Text[] {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const result: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (!node.textContent?.length) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    if (range.getClientRects().length && getComputedStyle(node.parentElement!).visibility !== 'hidden') result.push(node as Text);
  }
  return result;
}
function rangeAt(nodes: Text[], offset: number): Range | null {
  let remaining = Math.max(0, offset);
  for (const [index, node] of nodes.entries()) {
    const length = node.length;
    if (remaining < length || index === nodes.length - 1) {
      const range = document.createRange();
      const start = Math.min(remaining, Math.max(0, length - 1));
      range.setStart(node, start); range.setEnd(node, Math.min(start + 1, length));
      return range;
    }
    remaining -= length;
  }
  return null;
}
function lengths(element: Element, nodes: Text[]) {
  const displayed = nodes.reduce((sum, node) => sum + node.length, 0);
  const original = Number(element.getAttribute('data-source-length'));
  return { displayed, original: original > 0 ? original : displayed };
}
export function textRange(element: Element, offset = 0): Range | null {
  const text = content(element);
  const nodes = nodesOf(text);
  const { displayed, original } = lengths(text, nodes);
  const mapped = original ? Math.floor(Math.max(0, offset) / original * displayed) : 0;
  return rangeAt(nodes, mapped);
}
export function firstCharacterAt(element: Element, isBefore: (rect: DOMRect) => boolean): number {
  const text = content(element);
  const nodes = nodesOf(text);
  const { displayed, original } = lengths(text, nodes);
  let low = 0;
  let high = Math.max(0, displayed - 1);
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const rect = rangeAt(nodes, mid)?.getBoundingClientRect();
    if (rect && isBefore(rect)) low = mid + 1;
    else high = mid;
  }
  return displayed ? Math.min(Math.max(0, original - 1), Math.floor(low / displayed * original)) : 0;
}
