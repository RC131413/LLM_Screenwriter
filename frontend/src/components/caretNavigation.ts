export type CaretAffinity = 'forward' | 'backward';

/** Measure textarea carets using the same font, width, wrapping and alignment. */
function textLayout(element: HTMLTextAreaElement) {
  const range = document.createRange();
  if (typeof range.getBoundingClientRect !== 'function') return null;
  const computed = getComputedStyle(element);
  const mirror = document.createElement('div');
  for (const name of ['font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
    'line-height', 'letter-spacing', 'word-spacing', 'text-transform', 'text-align',
    'text-indent', 'tab-size', 'padding', 'border', 'word-break', 'overflow-wrap']) {
    mirror.style.setProperty(name, computed.getPropertyValue(name));
  }
  let width = parseFloat(computed.width) || element.offsetWidth;
  if (computed.boxSizing !== 'border-box') {
    for (const name of ['padding-left', 'padding-right', 'border-left-width', 'border-right-width']) {
      width += parseFloat(computed.getPropertyValue(name)) || 0;
    }
  }
  Object.assign(mirror.style, {
    position: 'fixed', left: '-100000px', top: '0', visibility: 'hidden', pointerEvents: 'none',
    boxSizing: 'border-box', width: `${width}px`, height: 'auto', margin: '0',
    whiteSpace: element.wrap === 'off' ? 'pre' : 'pre-wrap',
  });
  // The sentinel gives the empty last line a measurable caret after a newline.
  const text = document.createTextNode(element.value + '\u200b');
  mirror.append(text);
  document.body.append(mirror);
  const origin = mirror.getBoundingClientRect();
  const bounds = element.getBoundingClientRect();
  const scale = width ? bounds.width / width : 1;
  const point = (offset: number, affinity: CaretAffinity = 'forward') => {
    const backward = affinity === 'backward' && offset > 0 && element.value[offset - 1] !== '\n';
    range.setStart(text, backward ? offset - 1 : offset);
    // A collapsed DOM Range at a soft wrap can report the end of the preceding
    // row. The next glyph identifies the row containing this caret position.
    range.setEnd(text, backward ? offset : offset + 1);
    const rect = range.getBoundingClientRect();
    return {
      x: bounds.left + ((backward ? rect.right : rect.left) - origin.left - element.scrollLeft) * scale,
      y: bounds.top + (rect.top - origin.top - element.scrollTop) * scale,
      height: rect.height * scale,
    };
  };
  return { point, dispose: () => mirror.remove() };
}

/** Null offset means the browser should keep moving inside the current block. */
export function verticalCaretMove(
  source: HTMLTextAreaElement, target: HTMLTextAreaElement | undefined,
  direction: -1 | 1, preferredX?: number, affinity: CaretAffinity = 'forward',
): { offset: number | null; preferredX: number } | null {
  const sourceLayout = textLayout(source);
  if (!sourceLayout) return null;
  let x: number;
  try {
    const forward = sourceLayout.point(source.selectionStart);
    const backward = sourceLayout.point(source.selectionStart, 'backward');
    // A soft-wrap boundary has two visual positions at the same UTF-16 offset.
    // End/Left and mouse clicks select its upstream position; repeated vertical
    // moves retain the visual column instead of accidentally skipping a row.
    const caret = preferredX != null && Math.abs(forward.y - backward.y) > 1
      ? (Math.abs(backward.x - preferredX) < Math.abs(forward.x - preferredX) ? backward : forward)
      : affinity === 'backward' ? backward : forward;
    x = preferredX ?? caret.x;
    const edge = sourceLayout.point(direction === -1 ? 0 : source.value.length);
    if (!target || Math.abs(caret.y - edge.y) > 1) return { offset: null, preferredX: x };
  } finally { sourceLayout.dispose(); }
  const targetLayout = textLayout(target);
  if (!targetLayout) return null;
  try {
    const offsets = [0, ...Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(target.value),
      part => part.index + part.segment.length)];
    if (direction === -1) offsets.reverse();
    const edge = targetLayout.point(direction === -1 ? target.value.length : 0);
    let best = offsets[0];
    let distance = Infinity;
    for (const offset of offsets) {
      const caret = targetLayout.point(offset);
      if (Math.abs(caret.y - edge.y) > 1) break;
      const difference = Math.abs(caret.x - x);
      if (difference < distance) { distance = difference; best = offset; }
    }
    return { offset: best, preferredX: x };
  } finally { targetLayout.dispose(); }
}

export function pointerCaretAffinity(element: HTMLTextAreaElement, y: number): CaretAffinity {
  const layout = textLayout(element);
  if (!layout) return 'forward';
  try {
    const forward = layout.point(element.selectionStart);
    const backward = layout.point(element.selectionStart, 'backward');
    return Math.abs(y - backward.y - backward.height / 2) < Math.abs(y - forward.y - forward.height / 2)
      ? 'backward' : 'forward';
  } finally { layout.dispose(); }
}

export function focusCaret(element: HTMLTextAreaElement, offset: number) {
  element.focus({ preventScroll: true });
  element.setSelectionRange(offset, offset);
  const layout = textLayout(element);
  const scroller = element.closest('.document-scroll');
  if (!layout || !scroller) {
    layout?.dispose();
    element.scrollIntoView?.({ block: 'nearest' });
    return;
  }
  try {
    const caret = layout.point(offset);
    const bounds = scroller.getBoundingClientRect();
    if (caret.y < bounds.top + 8) scroller.scrollTop += caret.y - bounds.top - 8;
    else if (caret.y + caret.height > bounds.bottom - 8) {
      scroller.scrollTop += caret.y + caret.height - bounds.bottom + 8;
    }
  } finally { layout.dispose(); }
}
