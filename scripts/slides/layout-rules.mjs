// Values are pixels at 96 DPI. Body 24px = 18pt in PowerPoint.
export const SLIDE_RULES = Object.freeze({
  margin: 24,
  gap: 8,
  imageGap: 16,
  columnGap: 32,
  lineSpacing: 1.05,
  textSafety: 4,
  minimumFont: Object.freeze({ title: 40, body: 24, caption: 24, label: 20, eyebrow: 16, footer: 15 }),
});

export function teachingLayout(width = 1280, height = 720) {
  const margin = 48;
  const columnWidth = (width - margin * 2 - SLIDE_RULES.columnGap) / 2;
  return {
    title: { left: margin, top: 32, width: width - margin * 2, height: 120 },
    body: { left: margin, top: 184, width: columnWidth, height: height - 232 },
    image: { left: margin + columnWidth + SLIDE_RULES.columnGap, top: 184, width: columnWidth, height: height - 232 },
  };
}

export function containImage(imageWidth, imageHeight, region) {
  if (![imageWidth, imageHeight, region.width, region.height].every(v => Number.isFinite(v) && v > 0)) {
    throw new Error('Image and region dimensions must be positive finite numbers');
  }
  const scale = Math.min(region.width / imageWidth, region.height / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return { left: region.left + (region.width - width) / 2, top: region.top + (region.height - height) / 2, width, height };
}

export function wrapText(text, width, measure) {
  if (!(width > 0) || typeof measure !== 'function') throw new Error('Text measurement and positive width are required');
  const lines = [];
  for (const paragraph of text.split('\n')) {
    if (!paragraph.trim()) { lines.push(''); continue; }
    let line = '';
    for (const word of paragraph.trim().split(/\s+/u)) {
      if (measure(word) > width) throw new Error(`Text token is too wide: ${word.slice(0, 50)}`);
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next) > width) { lines.push(line); line = word; }
      else line = next;
    }
    lines.push(line);
  }
  return lines;
}

function validRect(rect) {
  return rect && ['left', 'top', 'width', 'height'].every(k => Number.isFinite(rect[k])) && rect.width > 0 && rect.height > 0;
}

function contained(inner, outer, tolerance = 0.1) {
  return inner.left >= outer.left - tolerance && inner.top >= outer.top - tolerance &&
    inner.left + inner.width <= outer.left + outer.width + tolerance &&
    inner.top + inner.height <= outer.top + outer.height + tolerance;
}

export function assertSlideLayout({ width, height, elements, slide = '?', measureText, measureFontHeight = e => e.fontSize * 1.2 }) {
  const issues = [];
  const safe = { left: SLIDE_RULES.margin, top: SLIDE_RULES.margin, width: width - 2 * SLIDE_RULES.margin, height: height - 2 * SLIDE_RULES.margin };
  if (!validRect(safe)) throw new Error(`Slide ${slide}: invalid canvas`);
  const ids = new Set();
  for (const element of elements) {
    const { id, frame, kind, role = 'body', text, fontSize, insets = {}, renderedLines } = element;
    if (!id || ids.has(id)) issues.push(`${id || '(unnamed)'}: missing or duplicate element id`);
    ids.add(id);
    if (!validRect(frame)) { issues.push(`${id}: invalid rectangle`); continue; }
    if (!contained(frame, safe)) issues.push(`${id}: outside safe page bounds`);
    if (element.region && (!validRect(element.region) || !contained(frame, element.region))) issues.push(`${id}: outside assigned region`);
    if (kind === 'image') {
      if (element.fit !== 'contain') issues.push(`${id}: instructional images must use contain`);
      continue;
    }
    if (kind !== 'text') { issues.push(`${id}: unsupported element kind`); continue; }
    const minimum = SLIDE_RULES.minimumFont[role];
    if (!minimum || !Number.isFinite(fontSize) || fontSize < minimum) issues.push(`${id}: font below ${minimum ?? 'known role'} minimum`);
    if (element.autoFit !== 'none') issues.push(`${id}: automatic shrinking/resizing is disabled`);
    if (typeof text !== 'string' || !text.trim()) { issues.push(`${id}: empty text`); continue; }
    const availableWidth = frame.width - (insets.left ?? 0) - (insets.right ?? 0) - SLIDE_RULES.textSafety;
    const availableHeight = frame.height - (insets.top ?? 0) - (insets.bottom ?? 0);
    try {
      const measure = value => {
        const width = measureText(value, element);
        if (!Number.isFinite(width) || width < 0) throw new Error('Invalid text width metric');
        return width;
      };
      const lines = wrapText(text, availableWidth, measure);
      const count = Math.max(lines.length, renderedLines?.length ?? 0);
      const fontHeight = measureFontHeight(element);
      if (!Number.isFinite(fontHeight) || fontHeight <= 0) throw new Error('Invalid font height metric');
      const neededHeight = count * fontHeight * SLIDE_RULES.lineSpacing + SLIDE_RULES.textSafety;
      if (neededHeight > availableHeight + 0.1) issues.push(`${id}: text overflow (${count} lines need ${neededHeight.toFixed(1)}px, have ${availableHeight.toFixed(1)}px)`);
      for (const line of renderedLines ?? []) {
        if (measure(line) > frame.width - (insets.left ?? 0) - (insets.right ?? 0) + 0.1) issues.push(`${id}: rendered line exceeds text width`);
      }
    } catch (error) { issues.push(`${id}: ${error.message}`); }
  }
  for (let i = 0; i < elements.length; i++) {
    for (let j = i + 1; j < elements.length; j++) {
      const a = elements[i], b = elements[j];
      if (!validRect(a.frame) || !validRect(b.frame)) continue;
      const dx = Math.max(a.frame.left, b.frame.left) - Math.min(a.frame.left + a.frame.width, b.frame.left + b.frame.width);
      const dy = Math.max(a.frame.top, b.frame.top) - Math.min(a.frame.top + a.frame.height, b.frame.top + b.frame.height);
      if (dx < -0.1 && dy < -0.1) issues.push(`${a.id} overlaps ${b.id}`);
      else {
        const required = a.kind === 'image' || b.kind === 'image' ? SLIDE_RULES.imageGap : SLIDE_RULES.gap;
        if (dx < required - 0.1 && dy < required - 0.1) issues.push(`${a.id} / ${b.id}: gap below ${required}px`);
      }
    }
  }
  if (issues.length) throw new Error(`Slide ${slide}:\n${issues.join('\n')}`);
  return { slide, elements: elements.length, overlaps: 0, overflows: 0 };
}
