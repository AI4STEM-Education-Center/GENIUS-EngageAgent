import { describe, expect, it } from 'vitest';
import { assertSlideLayout, containImage, teachingLayout, wrapText } from '../../scripts/slides/layout-rules.mjs';

const frame = { left: 48, top: 180, width: 400, height: 180 };
const text = (overrides = {}) => ({ id: 'body', kind: 'text', role: 'body', frame, text: 'A short observation.', fontSize: 24, autoFit: 'none', ...overrides });
const picture = (overrides = {}) => ({ id: 'image', kind: 'image', fit: 'contain', frame: { left: 520, top: 180, width: 360, height: 360 }, ...overrides });
const check = (elements: object[], width = 960) => assertSlideLayout({ width, height: 720, elements, slide: '2', measureText: (s: string) => s.length * 12 });

describe('slide layout export gates', () => {
  it('accepts separate text and image regions', () => expect(check([text(), picture()])).toMatchObject({ overlaps: 0 }));
  it('rejects the legacy full-width placeholder/image collision', () => expect(() => check([text({ frame: { ...frame, width: 864 } }), picture()])).toThrow('overlaps'));
  it('rejects the old 480px image at x=672 on a 960px slide', () => expect(() => check([picture({ frame: { left: 672, top: 144, width: 480, height: 480 } })])).toThrow('outside safe page bounds'));
  it('requires clear space even when objects merely touch', () => expect(() => check([text(), picture({ frame: { ...frame, left: 448 } })])).toThrow('gap below 16'));
  it('rejects vertical text overflow without shrinking', () => expect(() => check([text({ frame: { ...frame, height: 50 }, text: 'Word '.repeat(50) })])).toThrow('text overflow'));
  it('counts explicit blank lines', () => expect(() => check([text({ text: 'A\n\nB\n\nC\n\nD' })])).toThrow('text overflow'));
  it('rejects a long unbreakable token', () => expect(() => check([text({ text: 'x'.repeat(100) })])).toThrow('Text token is too wide'));
  it('rejects tiny body text', () => expect(() => check([text({ fontSize: 16 })])).toThrow('font below'));
  it('rejects shrinking to fit and expanding text frames', () => {
    for (const autoFit of ['shrinkText', 'resizeShapeToFitText']) expect(() => check([text({ autoFit })])).toThrow('automatic shrinking');
  });
  it('enforces assigned regions as well as page boundaries', () => expect(() => check([text({ region: { ...frame, width: 300 } })])).toThrow('outside assigned region'));
  it('uses resolved renderer lines to detect additional wrapping', () => expect(() => check([text({ renderedLines: Array(8).fill('A') })])).toThrow('text overflow'));
  it('rejects an over-wide rendered line', () => expect(() => check([text({ renderedLines: ['x'.repeat(40)] })])).toThrow('rendered line exceeds'));
  it('keeps footer type separate from student body type', () => expect(check([text({ role: 'footer', fontSize: 15 })])).toMatchObject({ overlaps: 0 }));
  it('fails closed when metrics are unavailable', () => expect(() => assertSlideLayout({ width: 960, height: 720, elements: [text()], measureText: undefined })).toThrow('measureText'));
  it('rejects invalid width and height measurements', () => {
    const options = { width: 960, height: 720, elements: [text()], measureText: () => NaN };
    expect(() => assertSlideLayout(options)).toThrow('Invalid text width metric');
    expect(() => assertSlideLayout({ ...options, measureText: () => 20, measureFontHeight: () => NaN })).toThrow('Invalid font height metric');
  });
  it('rejects invalid rectangles and duplicate IDs', () => {
    expect(() => check([text({ frame: { ...frame, width: NaN } })])).toThrow('invalid rectangle');
    expect(() => check([text(), picture({ id: 'body' })])).toThrow('duplicate');
  });
  it.each([960, 1280])('derives nonoverlapping columns from a %ipx canvas', width => {
    const layout = teachingLayout(width, 720);
    expect(layout.image.left - layout.body.left - layout.body.width).toBe(32);
    expect(check([text({ frame: layout.body, region: layout.body }), picture({ frame: containImage(1024, 1024, layout.image), region: layout.image })], width)).toMatchObject({ overlaps: 0 });
  });
  it.each([[1600, 900], [900, 1600], [1000, 1000]])('contains a %i by %i image without cropping or stretching', (w, h) => {
    const result = containImage(w, h, frame);
    expect(result.width / result.height).toBeCloseTo(w / h);
    expect(result.width).toBeLessThanOrEqual(frame.width);
    expect(result.height).toBeLessThanOrEqual(frame.height);
  });
  it('wraps at word boundaries while preserving paragraphs', () => expect(wrapText('one two three\nfour', 8, (s: string) => s.length)).toEqual(['one two', 'three', 'four']));
});
