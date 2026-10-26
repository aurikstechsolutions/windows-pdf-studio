import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import * as pdfjs from 'pdfjs-dist';
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import type { Font as ParsedFont } from '@pdf-lib/fontkit';
import type { LibraryFileSummary } from '@/lib/library-types';
import { Check, ChevronLeft, ChevronRight, FilePlus2, FileText, ImagePlus, LoaderCircle, Minus, MousePointer2, Plus, Redo2, Save, Trash2, Type, Undo2, Upload, X } from 'lucide-react';
import './pdf-edit-page.css';

type Props = {
  libraryPdfs: LibraryFileSummary[];
  onLoadLibraryPdf: (fileId: string) => Promise<Blob>;
  onSaveOutput: (blob: Blob, name: string) => Promise<void>;
};
type PdfDocument = any;
type TextItem = {
  id: string; page: number; text: string; x: number; y: number; width: number; height: number;
  fontSize: number; rotation: number; fontFamily: string; fontKey?: string; color: string;
  fontWeight: string; bold: boolean; italic: boolean;
  ascent: number; descent: number;
};
type TextFontData = Map<string, Uint8Array>;
type TextPaintRun = { text: string; color: string };
type FontkitApi = Parameters<PDFDocument['registerFontkit']>[0] & { create: (buffer: Uint8Array) => ParsedFont };
type ReplacementStyle = {
  fontFamily: 'source' | 'arial' | 'times' | 'courier';
  fontWeight: 'source' | 'regular' | 'bold';
  italic: boolean;
  fontSize: number;
  color: string;
};
type Edit =
  | { id: string; kind: 'replace'; page: number; source: TextItem; text: string; style?: ReplacementStyle }
  | { id: string; kind: 'text'; page: number; x: number; y: number; text: string; size: number }
  | { id: string; kind: 'image'; page: number; x: number; y: number; width: number; height: number; data: string; imageType: 'png' | 'jpg'; name: string }
  | { id: string; kind: 'erase'; page: number; x: number; y: number; width: number; height: number; rotation?: number };
type Tool = 'select' | 'text' | 'image' | 'erase';
type PageSize = { width: number; height: number; rotation: number };

const defaultReplacementStyle = (source: TextItem): ReplacementStyle => ({
  fontFamily: 'source',
  fontWeight: 'source',
  italic: source.italic,
  fontSize: source.fontSize,
  color: source.color,
});
const styleForReplacement = (edit: Extract<Edit, { kind: 'replace' }>): ReplacementStyle => ({
  ...defaultReplacementStyle(edit.source),
  ...edit.style,
});

const safeName = (value: string) => {
  const name = value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\.+$/g, '') || 'edited-document';
  return name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`;
};
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const registeredPdfFonts = new Map<string, Promise<boolean>>();
const bytesToFontKey = (bytes: Uint8Array) => {
  let hash = 2166136261;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
  return `pdf-embedded-${(hash >>> 0).toString(16)}`;
};
const asFontBytes = (value: unknown): Uint8Array | null => {
  if (value instanceof Uint8Array) return value.slice();
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice();
  }
  return null;
};
const ensurePreviewFont = (key: string, bytes: Uint8Array, weight: string, italic: boolean) => {
  const pending = registeredPdfFonts.get(key);
  if (pending) return pending;
  const promise = (async () => {
    try {
      const face = new FontFace(key, bytes.slice().buffer as ArrayBuffer, { weight, style: italic ? 'italic' : 'normal' });
      await face.load();
      document.fonts.add(face);
      return true;
    } catch {
      return false;
    }
  })();
  registeredPdfFonts.set(key, promise);
  return promise;
};
const rgbHex = (red: number, green: number, blue: number) => {
  const hex = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 255).toString(16).padStart(2, '0');
  return `#${hex(red)}${hex(green)}${hex(blue)}`;
};
const pdfRgbFromHex = (color: string) => {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color);
  return match ? rgb(Number.parseInt(match[1], 16) / 255, Number.parseInt(match[2], 16) / 255, Number.parseInt(match[3], 16) / 255) : rgb(0, 0, 0);
};
const textFromGlyphs = (value: unknown): string => {
  if (Array.isArray(value)) return value.map(textFromGlyphs).join('');
  if (value && typeof value === 'object' && 'unicode' in value && typeof value.unicode === 'string') return value.unicode;
  return '';
};
const normalizeTextRun = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim();
function readTextPaintRuns(operators: { fnArray: number[]; argsArray: unknown[][] }): TextPaintRun[] {
  const ops = pdfjs.OPS;
  let fill = '#000000';
  const saved: string[] = [];
  const runs: TextPaintRun[] = [];
  for (let index = 0; index < operators.fnArray.length; index += 1) {
    const operation = operators.fnArray[index];
    const args = operators.argsArray[index] ?? [];
    if (operation === ops.save) saved.push(fill);
    else if (operation === ops.restore) fill = saved.pop() ?? fill;
    else if (operation === ops.setFillRGBColor && typeof args[0] === 'string' && /^#[\da-f]{6}$/i.test(args[0])) fill = args[0];
    else if (operation === ops.setFillGray && typeof args[0] === 'number') fill = rgbHex(args[0], args[0], args[0]);
    else if (operation === ops.setFillCMYKColor && args.slice(0, 4).every((part) => typeof part === 'number')) {
      const [cyan, magenta, yellow, black] = args as number[];
      fill = rgbHex(1 - Math.min(1, cyan + black), 1 - Math.min(1, magenta + black), 1 - Math.min(1, yellow + black));
    } else if ([ops.showText, ops.showSpacedText, ops.nextLineShowText, ops.nextLineSetSpacingShowText].includes(operation)) {
      const text = textFromGlyphs(args).trim();
      if (text) runs.push({ text, color: fill });
    }
  }
  return runs;
}
function colorsForTextItems(items: Array<{ str: string }>, runs: TextPaintRun[]) {
  const colors: string[] = [];
  let cursor = 0;
  for (const item of items) {
    const target = normalizeTextRun(item.str);
    let match: { color: string; next: number } | null = null;
    const searchEnd = Math.min(runs.length, cursor + 32);
    for (let start = cursor; start < searchEnd && !match; start += 1) {
      if (normalizeTextRun(runs[start].text) === target) match = { color: runs[start].color, next: start + 1 };
    }
    for (let start = cursor; start < searchEnd && !match; start += 1) {
      let combined = '';
      for (let end = start; end < Math.min(runs.length, start + 8); end += 1) {
        combined = normalizeTextRun(`${combined} ${runs[end].text}`);
        if (combined === target || combined.startsWith(target)) {
          match = { color: runs[start].color, next: end + 1 };
          break;
        }
        if (!target.startsWith(combined)) break;
      }
    }
    if (match) {
      colors.push(match.color);
      cursor = match.next;
    } else {
      // Never borrow an unrelated earlier run's colour when text extraction
      // could not confidently associate this item with a painted text run.
      colors.push('#000000');
    }
  }
  return colors;
}
const fontFamilyForPreview = (fontFamily: string) => {
  if (fontFamily.startsWith('pdf-embedded-')) return `"${fontFamily}"`;
  const normalized = fontFamily.toLowerCase();
  if (normalized.includes('mono')) return '"Courier New", monospace';
  if (normalized.includes('serif') && !normalized.includes('sans')) return '"Times New Roman", serif';
  return 'Arial, sans-serif';
};
const replacementPreviewFamily = (source: TextItem, style: ReplacementStyle) => {
  if (style.fontFamily === 'source') {
    if (replacementUsesSourceFace(source, style)) return fontFamilyForPreview(source.fontFamily);
    if (source.fontFamily.startsWith('pdf-embedded-')) return 'Arial, sans-serif';
    return fontFamilyForPreview(source.fontFamily);
  }
  if (style.fontFamily === 'times') return '"Times New Roman", serif';
  if (style.fontFamily === 'courier') return '"Courier New", monospace';
  return 'Arial, sans-serif';
};
const replacementWeight = (source: TextItem, style: ReplacementStyle) => (
  style.fontWeight === 'source' ? source.fontWeight : style.fontWeight === 'bold' ? '700' : '400'
);
const replacementBold = (source: TextItem, style: ReplacementStyle) => (
  style.fontWeight === 'source' ? source.bold : style.fontWeight === 'bold'
);
const replacementUsesSourceFace = (source: TextItem, style: ReplacementStyle) => (
  style.fontFamily === 'source'
  && style.italic === source.italic
  && (style.fontWeight === 'source' || replacementBold(source, style) === source.bold)
);
const replacementWidth = (text: string, item: TextItem, style: ReplacementStyle) => {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return item.width;
  context.font = `${style.italic ? 'italic ' : ''}${replacementWeight(item, style)} ${style.fontSize}px ${replacementPreviewFamily(item, style)}`;
  return Math.max(item.width, context.measureText(text).width);
};
const standardFontFor = (item: TextItem, style?: ReplacementStyle) => {
  const normalized = style?.fontFamily && style.fontFamily !== 'source'
    ? style.fontFamily
    : item.fontFamily.toLowerCase();
  const bold = style ? replacementBold(item, style) : item.bold;
  const italic = style?.italic ?? item.italic;
  const family = normalized.includes('mono') || normalized === 'courier'
    ? 'Courier'
    : (normalized.includes('serif') && !normalized.includes('sans')) || normalized === 'times'
      ? 'TimesRoman'
      : 'Helvetica';
  if (family === 'TimesRoman') {
    if (bold && italic) return StandardFonts.TimesRomanBoldItalic;
    if (bold) return StandardFonts.TimesRomanBold;
    if (italic) return StandardFonts.TimesRomanItalic;
  } else if (family === 'Courier') {
    if (bold && italic) return StandardFonts.CourierBoldOblique;
    if (bold) return StandardFonts.CourierBold;
    if (italic) return StandardFonts.CourierOblique;
  } else {
    if (bold && italic) return StandardFonts.HelveticaBoldOblique;
    if (bold) return StandardFonts.HelveticaBold;
    if (italic) return StandardFonts.HelveticaOblique;
  }
  return family === 'TimesRoman' ? StandardFonts.TimesRoman : family === 'Courier' ? StandardFonts.Courier : StandardFonts.Helvetica;
};
function PageCanvas({ document, pageNumber, scale, onText }: { document: PdfDocument; pageNumber: number; scale: number; onText: (page: number, items: TextItem[], fonts: TextFontData) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [viewport, setViewport] = useState<any>(null);
  useEffect(() => {
    let active = true;
    let renderTask: any;
    void (async () => {
      const page = await document.getPage(pageNumber);
      const view = page.getViewport({ scale });
      const ratio = window.devicePixelRatio || 1;
      const canvas = canvasRef.current;
      if (!canvas || !active) return;
      canvas.width = Math.ceil(view.width * ratio);
      canvas.height = Math.ceil(view.height * ratio);
      canvas.style.width = `${view.width}px`;
      canvas.style.height = `${view.height}px`;
      setViewport(view);
      const context = canvas.getContext('2d');
      if (context) {
        renderTask = page.render({ canvasContext: context, viewport: view, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined });
        await renderTask.promise;
      }
      const content = await page.getTextContent();
      if (!active) return;
      const paintRuns = readTextPaintRuns(await page.getOperatorList());
      const sourceItems: Array<{ str: string; fontName: string; transform: number[]; width?: number; height?: number }> = content.items.filter((item: any) => 'str' in item && !!item.str.trim());
      const sourceColors = colorsForTextItems(sourceItems, paintRuns);
      const fontData: TextFontData = new Map();
      const pageFonts = new Map<string, { fontKey?: string; fontFamily: string }>();
      const found: TextItem[] = [];
      for (const [index, item] of sourceItems.entries()) {
        const matrix = item.transform;
        const style = content.styles[item.fontName];
        let fontFace: any = null;
        try { fontFace = page.commonObjs.get(item.fontName); } catch { /* use PDF.js text style metadata */ }
        const fontName = `${fontFace?.name ?? ''} ${fontFace?.fallbackName ?? ''} ${item.fontName}`;
        const declaredWeight = String(fontFace?.cssFontInfo?.fontWeight ?? (fontFace?.bold ? '700' : '400'));
        const italicAngle = fontFace?.cssFontInfo?.italicAngle;
        const bold = Boolean(fontFace?.bold) || Number.parseInt(declaredWeight, 10) >= 600 || /bold|black|heavy/i.test(`${fontName} ${declaredWeight}`);
        const weight = bold && !/^(?:[6-9]\d{2}|1000|bold|bolder)$/i.test(declaredWeight) ? '700' : declaredWeight;
        const italic = Boolean(fontFace?.italic) || (italicAngle != null && Number(italicAngle) !== 0) || /italic|oblique/i.test(fontName);
        let sourceFont = pageFonts.get(item.fontName);
        if (!sourceFont) {
          sourceFont = { fontFamily: style?.fontFamily ?? 'sans-serif' };
          const sourceBytes = asFontBytes(fontFace?.data);
          if (sourceBytes?.length) {
            const key = bytesToFontKey(sourceBytes);
            fontData.set(key, sourceBytes);
            sourceFont.fontKey = key;
            if (await ensurePreviewFont(key, sourceBytes, weight, italic)) {
              sourceFont.fontFamily = key;
            }
          }
          pageFonts.set(item.fontName, sourceFont);
        }
        const fontSize = Math.max(Math.hypot(Number(matrix[2]) || 0, Number(matrix[3]) || 0) || Number(item.height) || 10, 5);
        found.push({
          id: `p${pageNumber}-t${index}`,
          page: pageNumber,
          text: item.str,
          x: Number(matrix[4]) || 0,
          y: Number(matrix[5]) || 0,
          width: Math.max(Number(item.width) || 0, 4),
          height: Math.max(Number(item.height) || fontSize, 5),
          fontSize,
          rotation: Math.atan2(Number(matrix[1]) || 0, Number(matrix[0]) || 1),
          fontFamily: sourceFont.fontFamily,
          fontKey: sourceFont.fontKey,
          color: sourceColors[index] ?? '#000000',
          fontWeight: weight,
          bold,
          italic,
          ascent: Number.isFinite(style?.ascent) ? style.ascent : 0.8,
          descent: Number.isFinite(style?.descent) ? style.descent : -0.2,
        });
      }
      if (active) onText(pageNumber, found, fontData);
    })().catch(() => { if (active) onText(pageNumber, [], new Map()); });
    return () => { active = false; renderTask?.cancel?.(); };
  }, [document, pageNumber, scale, onText]);
  return <div className="pedit-page-canvas" style={viewport ? { width: viewport.width, height: viewport.height } : undefined} data-testid={`canvas-edit-page-${pageNumber}`}>
    <canvas ref={canvasRef} aria-label={`Rendered PDF page ${pageNumber}`} />
    {viewport && <PageOverlay pageNumber={pageNumber} viewport={viewport} />}
  </div>;
}

function PageOverlay({ pageNumber, viewport }: { pageNumber: number; viewport: any }) {
  const overlayData = useEditOverlay();
  const selectedPoint = overlayData.selectedText?.page === pageNumber
    ? viewport.convertToViewportPoint(overlayData.selectedText.x, overlayData.selectedText.y)
    : null;
  return <div className="pedit-overlay-root" style={{ width: viewport.width, height: viewport.height }}>
    {overlayData.items.filter((item) => item.page === pageNumber).map((item) => {
      const ux = Math.cos(item.rotation), uy = Math.sin(item.rotation);
      const nx = -uy, ny = ux;
      const replacement = overlayData.edits.find((edit) => edit.kind === 'replace' && edit.source.id === item.id) as Extract<Edit, { kind: 'replace' }> | undefined;
      const replacementStyle = replacement ? styleForReplacement(replacement) : null;
      const hitWidth = replacement && replacementStyle ? Math.max(item.width, replacementWidth(replacement.text, item, replacementStyle)) : item.width;
      const hitHeight = replacementStyle ? Math.max(item.height, replacementStyle.fontSize * (item.ascent - item.descent)) : item.height;
      const originX = item.x - nx * hitHeight * 0.24;
      const originY = item.y - ny * hitHeight * 0.24;
      const rawPoints = [
        [originX, originY],
        [originX + ux * hitWidth, originY + uy * hitWidth],
        [originX + nx * hitHeight, originY + ny * hitHeight],
        [originX + ux * hitWidth + nx * hitHeight, originY + uy * hitWidth + ny * hitHeight],
      ];
      const points = rawPoints.map(([x, y]) => viewport.convertToViewportPoint(x, y));
      const left = Math.min(...points.map((point: number[]) => point[0]));
      const top = Math.min(...points.map((point: number[]) => point[1]));
      const width = Math.max(3, Math.max(...points.map((point: number[]) => point[0])) - left);
      const height = Math.max(7, Math.max(...points.map((point: number[]) => point[1])) - top);
      const baseline = viewport.convertToViewportPoint(item.x, item.y);
      const baselineEnd = viewport.convertToViewportPoint(item.x + ux, item.y + uy);
      const screenRotation = Math.atan2(baselineEnd[1] - baseline[1], baselineEnd[0] - baseline[0]) * 180 / Math.PI;
      const maskPadding = viewport.scale;
      const maskFontSize = replacementStyle ? Math.max(item.fontSize, replacementStyle.fontSize) : item.fontSize;
      const maskHeight = Math.max(1, maskFontSize * (item.ascent - item.descent) * viewport.scale + maskPadding * 2);
      const maskWidth = replacement && replacementStyle ? Math.max(item.width, replacementWidth(replacement.text, item, replacementStyle)) * viewport.scale + maskPadding * 2 : 0;
      return <button key={item.id} className={`pedit-text-hit${overlayData.selectedText?.id === item.id ? ' selected' : ''}`} style={{ left, top, width, height }} onClick={() => overlayData.selectText(item)} title={`Edit text: ${item.text}`} data-testid={`button-edit-text-item-${item.id}`}>
        {replacement && replacementStyle && <>
          <span className="pedit-replacement-mask" aria-hidden="true" style={{ left: baseline[0] - left - maskPadding, top: baseline[1] - top - maskFontSize * item.ascent * viewport.scale - maskPadding, width: maskWidth, height: maskHeight, transform: `rotate(${screenRotation}deg)` }} />
          <span className="pedit-replacement-preview" style={{ left: baseline[0] - left, top: baseline[1] - top, fontSize: `${replacementStyle.fontSize * viewport.scale}px`, fontFamily: replacementPreviewFamily(item, replacementStyle), fontWeight: replacementWeight(item, replacementStyle), fontStyle: replacementStyle.italic ? 'italic' : 'normal', color: replacementStyle.color, transform: `translateY(-${item.ascent * 100}%) rotate(${screenRotation}deg)` }}>{replacement.text}</span>
        </>}
      </button>;
    })}
    {selectedPoint && overlayData.selectedText && <div className="pedit-inline-editor" style={{ left: selectedPoint[0], top: selectedPoint[1] }} onClick={(event) => event.stopPropagation()} data-testid="panel-edit-inline-text">
      <strong className="pedit-inline-title">{overlayData.edits.some((edit) => edit.kind === 'replace' && edit.source.id === overlayData.selectedText?.id) ? 'Edit this replacement' : 'Replace selected text'}</strong>
      <textarea autoFocus value={overlayData.inlineValue} onChange={(event) => overlayData.setInlineValue(event.currentTarget.value)} aria-label="Replace selected PDF text" data-testid="input-edit-inline-text" />
      <div className="pedit-style-controls" aria-label="Text appearance settings">
        <label className="pedit-style-family"><span>Font</span><select value={overlayData.inlineStyle.fontFamily} onChange={(event) => overlayData.updateInlineStyle({ fontFamily: event.currentTarget.value as ReplacementStyle['fontFamily'] })} aria-label="Font family">
          <option value="source">Source font</option><option value="arial">Arial / Helvetica</option><option value="times">Times New Roman</option><option value="courier">Courier New</option>
        </select></label>
        <label><span>Weight</span><select value={overlayData.inlineStyle.fontWeight} onChange={(event) => overlayData.updateInlineStyle({ fontWeight: event.currentTarget.value as ReplacementStyle['fontWeight'] })} aria-label="Font weight">
          <option value="source">Source weight</option><option value="regular">Regular</option><option value="bold">Bold</option>
        </select></label>
        <label><span>Size</span><input type="number" min="4" max="250" step="0.5" value={overlayData.inlineStyle.fontSize} onChange={(event) => {
          const size = Number.parseFloat(event.currentTarget.value);
          if (Number.isFinite(size)) overlayData.updateInlineStyle({ fontSize: Math.max(4, Math.min(250, size)) });
        }} aria-label="Font size in points" /></label>
        <label className="pedit-style-color"><span>Colour</span><input type="color" value={overlayData.inlineStyle.color} onChange={(event) => overlayData.updateInlineStyle({ color: event.currentTarget.value })} aria-label="Text colour" /></label>
        <label className="pedit-style-italic"><input type="checkbox" checked={overlayData.inlineStyle.italic} onChange={(event) => overlayData.updateInlineStyle({ italic: event.currentTarget.checked })} />Italic</label>
      </div>
      <div><button type="button" onClick={overlayData.commitReplacement} data-testid="button-edit-commit-text"><Check size={14} />Apply</button><button type="button" onClick={overlayData.deleteText} data-testid="button-edit-delete-text"><Trash2 size={14} />Delete</button><button type="button" onClick={overlayData.cancelText} aria-label="Cancel text edit" data-testid="button-edit-cancel-text"><X size={14} /></button></div>
    </div>}
    {overlayData.edits.filter((edit) => edit.page === pageNumber && edit.kind !== 'replace').map((edit) => {
      if (edit.kind === 'text') {
        const point = viewport.convertToViewportPoint(edit.x, edit.y);
        return <div key={edit.id} className={`pedit-added-text${overlayData.selectedEditId === edit.id ? ' chosen' : ''}`} style={{ left: point[0], top: point[1] - edit.size * viewport.scale, fontSize: `${edit.size * viewport.scale}px` }} onPointerDown={(event) => overlayData.beginMove(event, edit)} data-testid={`overlay-edit-text-${edit.id}`}>{edit.text || 'Text'}</div>;
      }
      if (edit.kind === 'image') {
        const box = viewport.convertToViewportRectangle([edit.x, edit.y, edit.x + edit.width, edit.y + edit.height]);
        const left = Math.min(box[0], box[2]), top = Math.min(box[1], box[3]);
        return <div key={edit.id} className={`pedit-image-overlay${overlayData.selectedEditId === edit.id ? ' chosen' : ''}`} style={{ left, top, width: Math.abs(box[2] - box[0]), height: Math.abs(box[3] - box[1]) }} onPointerDown={(event) => overlayData.beginMove(event, edit)} data-testid={`overlay-edit-image-${edit.id}`}>
          <img src={edit.data} alt={edit.name} draggable={false} />
          {overlayData.selectedEditId === edit.id && <span className="pedit-resize-grip" onPointerDown={(event) => overlayData.beginResize(event, edit)} />}
        </div>;
      }
      if (edit.kind !== 'erase') return null;
      const ux = Math.cos(edit.rotation ?? 0), uy = Math.sin(edit.rotation ?? 0), nx = -uy, ny = ux;
      const corners = [
        [edit.x, edit.y], [edit.x + ux * edit.width, edit.y + uy * edit.width],
        [edit.x + nx * edit.height, edit.y + ny * edit.height],
        [edit.x + ux * edit.width + nx * edit.height, edit.y + uy * edit.width + ny * edit.height],
      ].map(([x, y]) => viewport.convertToViewportPoint(x, y));
      const left = Math.min(...corners.map((point: number[]) => point[0]));
      const top = Math.min(...corners.map((point: number[]) => point[1]));
      const right = Math.max(...corners.map((point: number[]) => point[0]));
      const bottom = Math.max(...corners.map((point: number[]) => point[1]));
      return <div key={edit.id} className="pedit-erase-overlay" style={{ left, top, width: right - left, height: bottom - top }} data-testid={`overlay-edit-erase-${edit.id}`} />;
    })}
  </div>;
}

// The page overlay is coordinated by a small module-level bridge so the canvas
// stays isolated from the editor's state and page rendering remains lightweight.
let activeOverlay: {
  items: TextItem[]; edits: Edit[]; selectedText: TextItem | null; selectedEditId: string | null;
  selectText: (item: TextItem) => void; beginMove: (event: ReactPointerEvent, edit: Edit) => void; beginResize: (event: ReactPointerEvent, edit: Edit) => void;
  inlineValue: string; setInlineValue: (value: string) => void; commitReplacement: () => void; deleteText: () => void; cancelText: () => void;
  inlineStyle: ReplacementStyle; updateInlineStyle: (patch: Partial<ReplacementStyle>) => void;
} | null = null;
function useEditOverlay() {
  const [, update] = useState(0);
  useEffect(() => {
    const listener = () => update((value) => value + 1);
    window.addEventListener('pedit-overlay-update', listener);
    return () => window.removeEventListener('pedit-overlay-update', listener);
  }, []);
  return activeOverlay ?? { items: [], edits: [], selectedText: null, selectedEditId: null, selectText: () => {}, beginMove: () => {}, beginResize: () => {}, inlineStyle: { fontFamily: 'source', fontWeight: 'source', italic: false, fontSize: 12, color: '#000000' }, updateInlineStyle: () => {} };
}

export function PdfEditPage({ libraryPdfs, onLoadLibraryPdf, onSaveOutput }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fontDataRef = useRef<TextFontData>(new Map());
  const [source, setSource] = useState<{ blob: Blob; name: string } | null>(null);
  const [pdf, setPdf] = useState<PdfDocument | null>(null);
  const [pages, setPages] = useState<PageSize[]>([]);
  const [textItems, setTextItems] = useState<TextItem[]>([]);
  const [edits, setEdits] = useState<Edit[]>([]);
  const [undoStack, setUndoStack] = useState<Edit[][]>([]);
  const [redoStack, setRedoStack] = useState<Edit[][]>([]);
  const [selectedText, setSelectedText] = useState<TextItem | null>(null);
  const [selectedEditId, setSelectedEditId] = useState<string | null>(null);
  const [inlineValue, setInlineValue] = useState('');
  const [inlineStyle, setInlineStyle] = useState<ReplacementStyle>({ fontFamily: 'source', fontWeight: 'source', italic: false, fontSize: 12, color: '#000000' });
  const [tool, setTool] = useState<Tool>('select');
  const [pendingImage, setPendingImage] = useState<{ data: string; name: string; imageType: 'png' | 'jpg'; width: number; height: number } | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [outputName, setOutputName] = useState('');
  const [savedName, setSavedName] = useState('');
  const [savedToken, setSavedToken] = useState('[]');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [editWarning, setEditWarning] = useState('');

  const dirty = JSON.stringify(edits) !== savedToken || outputName !== savedName;
  const itemsByPage = useMemo(() => textItems, [textItems]);
  const notifyOverlay = useCallback(() => window.dispatchEvent(new Event('pedit-overlay-update')), []);
  const remember = useCallback((next: Edit[]) => {
    setUndoStack((history) => [...history, edits]);
    setRedoStack([]);
    setEdits(next);
    setSuccess('');
    notifyOverlay();
  }, [edits, notifyOverlay]);
  const openPdf = useCallback(async (blob: Blob, name: string) => {
    setLoading(true); setError(''); setSuccess('');
    try {
      const loaded = await pdfjs.getDocument({ data: await blob.arrayBuffer() }).promise;
      const dimensions: PageSize[] = [];
      for (let index = 1; index <= loaded.numPages; index += 1) {
        const page = await loaded.getPage(index);
        const view = page.getViewport({ scale: 1 });
        dimensions.push({ width: page.view[2] - page.view[0], height: page.view[3] - page.view[1], rotation: view.rotation });
      }
      setSource({ blob, name });
      setPdf(loaded);
      setPages(dimensions);
      fontDataRef.current.clear();
      setTextItems([]);
      setEdits([]); setUndoStack([]); setRedoStack([]);
      setOutputName(`${name.replace(/\.pdf$/i, '')}-edited.pdf`);
      setSavedName(`${name.replace(/\.pdf$/i, '')}-edited.pdf`);
      setSavedToken('[]');
      setSelectedText(null); setSelectedEditId(null); setPageNumber(1);
      setEditWarning('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'This PDF could not be opened. It may be damaged, encrypted, or unsupported.');
    } finally { setLoading(false); }
  }, []);
  const discardOk = () => !dirty || window.confirm('Discard your unsaved page edits?');
  const openLocal = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
    if (!file) return;
    if (!discardOk()) return;
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') { setError('Choose a PDF file.'); return; }
    void openPdf(file, file.name);
  };
  const openLibrary = async (id: string) => {
    if (!id || !discardOk()) return;
    const file = libraryPdfs.find((item) => item.id === id);
    if (!file) { setError('This PDF is no longer available in File Manager.'); return; }
    try { await openPdf(await onLoadLibraryPdf(id), file.name); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load that PDF from File Manager.'); }
  };
  const receiveText = useCallback((page: number, found: TextItem[], fonts: TextFontData) => {
    for (const [key, bytes] of fonts) fontDataRef.current.set(key, bytes);
    setTextItems((old) => [...old.filter((item) => item.page !== page), ...found]);
  }, []);

  const commitReplacement = () => {
    if (!selectedText) return;
    if (!inlineValue.trim()) { setError('Replacement text cannot be empty. Use Delete text to remove this item.'); return; }
    const previous = edits.find((edit) => edit.kind === 'replace' && edit.source.id === selectedText.id) as Extract<Edit, { kind: 'replace' }> | undefined;
    const next = edits.filter((edit) => !(edit.kind === 'replace' && edit.source.id === selectedText.id));
    next.push({ id: previous?.id ?? uid(), kind: 'replace', page: selectedText.page, source: selectedText, text: inlineValue, style: { ...inlineStyle } });
    remember(next); setSelectedText(null); setEditWarning('Replacement covers the original text with a white mask. This works best on plain backgrounds; complex artwork behind the text may be obscured.');
  };
  const deleteText = () => {
    if (!selectedText) return;
    const source = selectedText;
    const cover: Extract<Edit, { kind: 'erase' }> = {
      id: uid(), kind: 'erase', page: source.page, x: source.x, y: source.y - source.height * 0.24,
      width: source.width, height: source.height, rotation: source.rotation,
    };
    remember([...edits.filter((edit) => !(edit.kind === 'replace' && edit.source.id === source.id)), cover]);
    setSelectedText(null); setInlineValue('');
    setEditWarning('Text is covered with a white mask; it is not removed from the underlying PDF stream. This works best on plain backgrounds.');
  };
  const setOverlay = useCallback(() => {
    activeOverlay = {
      items: itemsByPage, edits, selectedText, selectedEditId,
      selectText: (item) => {
        if (tool !== 'select') return;
        const previous = edits.find((edit) => edit.kind === 'replace' && edit.source.id === item.id) as Extract<Edit, { kind: 'replace' }> | undefined;
        setSelectedText(item);
        setSelectedEditId(null);
        setInlineValue(previous?.text ?? item.text);
        setInlineStyle(previous ? styleForReplacement(previous) : defaultReplacementStyle(item));
        setEditWarning('');
      },
      beginMove: (event, edit) => { event.stopPropagation(); setSelectedEditId(edit.id); setSelectedText(null); },
      beginResize: () => {},
      inlineValue, setInlineValue, commitReplacement, deleteText, cancelText: () => setSelectedText(null),
      inlineStyle, updateInlineStyle: (patch) => setInlineStyle((current) => ({ ...current, ...patch })),
    };
    notifyOverlay();
  }, [itemsByPage, edits, selectedText, selectedEditId, inlineValue, inlineStyle, tool, notifyOverlay]);
  useEffect(() => { setOverlay(); }, [setOverlay]);
  const undo = () => {
    if (!undoStack.length) return;
    setRedoStack((history) => [...history, edits]);
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((history) => history.slice(0, -1)); setEdits(previous); setSelectedEditId(null); setSelectedText(null);
  };
  const redo = () => {
    if (!redoStack.length) return;
    setUndoStack((history) => [...history, edits]);
    setEdits(redoStack[redoStack.length - 1]); setRedoStack((history) => history.slice(0, -1));
  };
  const getPageViewport = useCallback((page: number) => pdf?.getPage(page).then((value: any) => value.getViewport({ scale: zoom })), [pdf, zoom]);

  const pageClick = async (event: ReactMouseEvent<HTMLDivElement>, page: number) => {
    if (tool === 'select' || !pdf) return;
    const container = event.currentTarget;
    const bounds = container.getBoundingClientRect();
    const viewport = await getPageViewport(page);
    if (!viewport) return;
    const [x, y] = viewport.convertToPdfPoint(event.clientX - bounds.left, event.clientY - bounds.top);
    if (tool === 'text') {
      const text: Extract<Edit, { kind: 'text' }> = { id: uid(), kind: 'text', page, x, y, text: 'Type here', size: 12 };
      remember([...edits, text]); setSelectedEditId(text.id); setTool('select');
    } else if (tool === 'image' && pendingImage) {
      const image: Extract<Edit, { kind: 'image' }> = { ...pendingImage, id: uid(), kind: 'image', page, x, y: y - pendingImage.height, width: pendingImage.width, height: pendingImage.height };
      remember([...edits, image]); setSelectedEditId(image.id); setPendingImage(null); setTool('select');
    } else if (tool === 'erase') {
      const erase: Extract<Edit, { kind: 'erase' }> = { id: uid(), kind: 'erase', page, x, y: y - 24, width: 120, height: 48 };
      remember([...edits, erase]); setSelectedEditId(erase.id); setTool('select');
    }
  };
  const readImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) { setError('Choose a PNG or JPEG image.'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') return;
      const data = reader.result;
      const imageType = file.type === 'image/png' ? 'png' : 'jpg';
      const dimensions = new Image();
      dimensions.onload = () => {
        const selected = edits.find((edit) => edit.id === selectedEditId);
        if (selected?.kind === 'image') {
          const fit = Math.min(
            selected.width / Math.max(1, dimensions.naturalWidth),
            selected.height / Math.max(1, dimensions.naturalHeight),
          );
          const width = Math.max(8, dimensions.naturalWidth * fit);
          const height = Math.max(8, dimensions.naturalHeight * fit);
          const x = selected.x + (selected.width - width) / 2;
          const y = selected.y + (selected.height - height) / 2;
          remember(edits.map((edit) => edit.id === selected.id
            ? { ...selected, data, name: file.name, imageType, x, y, width, height }
            : edit));
        } else if (selected?.kind === 'erase') {
          const image: Extract<Edit, { kind: 'image' }> = {
            id: uid(), kind: 'image', page: selected.page, x: selected.x, y: selected.y,
            width: selected.width, height: selected.height, data, imageType, name: file.name,
          };
          remember([...edits, image]);
          setSelectedEditId(image.id);
          setEditWarning('The white cover remains under the new image to hide the original page content.');
        } else {
          const fit = Math.min(
            1,
            144 / Math.max(1, dimensions.naturalWidth),
            144 / Math.max(1, dimensions.naturalHeight),
          );
          setPendingImage({
            data, name: file.name, imageType,
            width: dimensions.naturalWidth * fit,
            height: dimensions.naturalHeight * fit,
          });
          setTool('image');
        }
      };
      dimensions.onerror = () => setError('That image could not be decoded.');
      dimensions.src = data;
    };
    reader.onerror = () => setError('That image could not be read.');
    reader.readAsDataURL(file);
  };
  const updateSelected = (id: string, updater: (edit: Edit) => Edit) => {
    remember(edits.map((edit) => edit.id === id ? updater(edit) : edit));
  };
  const deleteSelected = () => {
    if (!selectedEditId) return;
    remember(edits.filter((edit) => edit.id !== selectedEditId)); setSelectedEditId(null);
  };
  const savePdf = async () => {
    if (!source || !pdf) { setError('Open a PDF before saving page edits.'); return; }
    if (!outputName.trim()) { setError('Enter a filename before saving.'); return; }
    setBusy(true); setError(''); setSuccess('');
    try {
      const output = await PDFDocument.load(await source.blob.arrayBuffer());
      const fontkitModule = await import('@pdf-lib/fontkit') as unknown as { default: FontkitApi };
      const fontkit = fontkitModule.default;
      output.registerFontkit(fontkit);
      const pageList = output.getPages();
      let usedFontFallback = false;
      for (const edit of edits) {
        const target = pageList[edit.page - 1];
        if (!target) continue;
        if (edit.kind === 'replace') {
          const { source: original, text } = edit;
          const style = styleForReplacement(edit);
          const canReuseSourceFace = replacementUsesSourceFace(original, style);
          let font = null;
          const embeddedFont = canReuseSourceFace && original.fontKey ? fontDataRef.current.get(original.fontKey) : undefined;
          if (embeddedFont?.length) {
            try {
              const sourceFont = fontkit.create(embeddedFont);
              const supportsText = Array.from(text).every((character) => sourceFont.hasGlyphForCodePoint(character.codePointAt(0) ?? 0));
              if (supportsText) font = await output.embedFont(embeddedFont);
            } catch {
              font = null;
            }
          }
          if (!font && style.fontFamily === 'source') usedFontFallback = true;
          font ??= await output.embedFont(standardFontFor(original, style));
          const padding = 1;
          const maskWidth = Math.max(original.width, font.widthOfTextAtSize(text, style.fontSize)) + padding * 2;
          const maskHeight = Math.max(original.fontSize, style.fontSize) * (original.ascent - original.descent) + padding * 2;
          const ux = Math.cos(original.rotation), uy = Math.sin(original.rotation);
          const nx = -uy, ny = ux;
          const bottomLeftX = original.x - ux * padding + nx * (original.descent * style.fontSize - padding);
          const bottomLeftY = original.y - uy * padding + ny * (original.descent * style.fontSize - padding);
          const centerX = bottomLeftX + ux * maskWidth / 2 + nx * maskHeight / 2;
          const centerY = bottomLeftY + uy * maskWidth / 2 + ny * maskHeight / 2;
          target.drawRectangle({
            x: centerX - maskWidth / 2, y: centerY - maskHeight / 2,
            width: maskWidth, height: maskHeight,
            rotate: degrees(original.rotation * 180 / Math.PI), color: rgb(1, 1, 1),
          });
          target.drawText(text, { x: original.x, y: original.y, size: style.fontSize, font, rotate: degrees(original.rotation * 180 / Math.PI), color: pdfRgbFromHex(style.color), maxWidth: Math.max(original.width, font.widthOfTextAtSize(text, style.fontSize)), lineHeight: style.fontSize });
        } else if (edit.kind === 'text') {
          const font = await output.embedFont(StandardFonts.Helvetica);
          target.drawText(edit.text, { x: edit.x, y: edit.y, size: edit.size, font });
        } else if (edit.kind === 'erase') {
          target.drawRectangle({ x: edit.x, y: edit.y, width: edit.width, height: edit.height, rotate: degrees(edit.rotation ?? 0), color: rgb(1, 1, 1) });
        } else {
          const bytes = Uint8Array.from(atob(edit.data.split(',')[1]), (character) => character.charCodeAt(0));
          const image = edit.imageType === 'png' ? await output.embedPng(bytes) : await output.embedJpg(bytes);
          target.drawImage(image, { x: edit.x, y: edit.y, width: edit.width, height: edit.height });
        }
      }
      const bytes = await output.save();
      const blob = new Blob([new Uint8Array(bytes).buffer as ArrayBuffer], { type: 'application/pdf' });
      const name = safeName(outputName);
      await onSaveOutput(blob, name);
      setOutputName(name); setSavedName(name); setSavedToken(JSON.stringify(edits)); setSuccess(`${name} saved as a new PDF. The opened source remains unchanged.`);
      setEditWarning(usedFontFallback ? 'At least one replacement used a standard PDF font because the selected source font variant was unavailable or did not include all replacement characters.' : '');
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '';
      setError(/WinAnsi|encode|character/i.test(message)
        ? 'This text contains characters the built-in PDF standard font cannot encode. Use basic Latin characters or remove the unsupported symbols.'
        : `Could not export this PDF: ${message || 'unsupported or damaged document'}`);
    } finally { setBusy(false); }
  };
  const startMove = useCallback((event: ReactPointerEvent, edit: Edit) => {
    if (edit.kind !== 'image' && edit.kind !== 'text') return;
    event.stopPropagation();
    const pageRoot = (event.currentTarget as HTMLElement).closest('.pedit-page-canvas') as HTMLElement | null;
    if (!pageRoot || !pdf) return;
    setSelectedEditId(edit.id); setSelectedText(null);
    const startX = event.clientX, startY = event.clientY;
    const pageBounds = pageRoot.getBoundingClientRect();
    const initial = { ...edit };
    void getPageViewport(edit.page).then((viewport: any) => {
      if (!viewport) return;
      const origin = viewport.convertToPdfPoint(startX - pageBounds.left, startY - pageBounds.top);
      let moved = false;
      const onMove = (moveEvent: PointerEvent) => {
        const point = viewport.convertToPdfPoint(moveEvent.clientX - pageBounds.left, moveEvent.clientY - pageBounds.top);
        const dx = point[0] - origin[0], dy = point[1] - origin[1];
        moved = moved || Math.abs(dx) + Math.abs(dy) > 0.2;
        setEdits((current) => current.map((item) => item.id === initial.id ? { ...initial, x: initial.x + dx, y: initial.y + dy } as Edit : item));
        notifyOverlay();
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
        if (moved) { setUndoStack((history) => [...history, edits]); setRedoStack([]); }
      };
      window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp, { once: true });
    });
  }, [pdf, edits, getPageViewport, notifyOverlay]);
  const startResize = useCallback((event: ReactPointerEvent, edit: Edit) => {
    if (edit.kind !== 'image') return;
    event.stopPropagation();
    event.preventDefault();
    const pageRoot = (event.currentTarget as HTMLElement).closest('.pedit-page-canvas') as HTMLElement | null;
    if (!pageRoot || !pdf) return;
    setSelectedEditId(edit.id); setSelectedText(null);
    const startX = event.clientX, startY = event.clientY;
    const pageBounds = pageRoot.getBoundingClientRect();
    const initial = { ...edit };
    void getPageViewport(edit.page).then((viewport: any) => {
      if (!viewport) return;
      const origin = viewport.convertToPdfPoint(startX - pageBounds.left, startY - pageBounds.top);
      const aspect = initial.width / Math.max(1, initial.height);
      const onMove = (moveEvent: PointerEvent) => {
        const point = viewport.convertToPdfPoint(moveEvent.clientX - pageBounds.left, moveEvent.clientY - pageBounds.top);
        const width = Math.max(8, initial.width + point[0] - origin[0]);
        const height = Math.max(8, width / aspect);
        setEdits((current) => current.map((item) => item.id === initial.id ? { ...initial, width, height } : item));
        notifyOverlay();
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
        setUndoStack((history) => [...history, edits]); setRedoStack([]);
      };
      window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp, { once: true });
    });
  }, [pdf, edits, getPageViewport, notifyOverlay]);
  // Install live interaction bridge after callbacks are defined.
  useEffect(() => {
    if (!activeOverlay) return;
    activeOverlay.beginMove = startMove;
    activeOverlay.beginResize = startResize;
    notifyOverlay();
  }, [startMove, startResize, notifyOverlay]);
  const navigateToPage = (nextPage: number) => {
    const targetPage = Math.max(1, Math.min(pages.length, nextPage));
    setPageNumber(targetPage);
    const stage = stageRef.current;
    const page = stage?.querySelector<HTMLElement>(`[data-page-index="${targetPage}"]`);
    if (stage && page) {
      const stageBounds = stage.getBoundingClientRect();
      const pageBounds = page.getBoundingClientRect();
      stage.scrollTo({ top: stage.scrollTop + pageBounds.top - stageBounds.top - 20, behavior: 'smooth' });
    }
  };

  return <main className="page-wrap pdf-edit-page">
    <input ref={fileInput} className="pedit-hidden" type="file" accept="application/pdf,.pdf" onChange={openLocal} data-testid="input-edit-pdf" />
    <input ref={imageInput} className="pedit-hidden" type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" onChange={readImage} data-testid="input-edit-image" />
    <header className="pedit-header">
      <div className="pedit-document">
        <span className="pedit-mark"><FileText size={18} /></span>
        <label htmlFor="pedit-name"><small>Output filename</small><input id="pedit-name" value={outputName} placeholder="edited-document.pdf" onChange={(event) => setOutputName(event.currentTarget.value)} data-testid="input-edit-output-name" /></label>
      </div>
      <span className={`pedit-dirty${dirty ? ' dirty' : ''}`} data-testid="status-edit-unsaved"><i />{dirty ? 'Unsaved page edits' : 'No unsaved edits'}</span>
      <button className="pedit-save" type="button" onClick={() => void savePdf()} disabled={busy || loading || !source} data-testid="button-edit-save-pdf">{busy ? <LoaderCircle className="pedit-spin" size={16} /> : <Save size={16} />}Save as new PDF</button>
    </header>
    <section className="pedit-openbar" aria-label="Open a PDF">
      <div className="pedit-source-meta"><strong data-testid="text-edit-source-name">{source?.name ?? 'No PDF open'}</strong><span>{source ? `${pages.length} ${pages.length === 1 ? 'page' : 'pages'} · original page artwork stays in place` : 'Open a local document or choose one from File Manager'}</span></div>
      <div className="pedit-open-actions">
        <button type="button" className="pedit-secondary" onClick={() => { if (discardOk()) fileInput.current?.click(); }} disabled={loading || busy} data-testid="button-edit-open-local"><Upload size={15} />Open PDF</button>
        <select value="" aria-label="Open from File Manager" onChange={(event) => void openLibrary(event.currentTarget.value)} disabled={!libraryPdfs.length || busy || loading} data-testid="select-edit-library-pdf"><option value="">File Manager…</option>{libraryPdfs.map((file) => <option key={file.id} value={file.id}>{file.name}</option>)}</select>
      </div>
    </section>
    {loading && <div className="pedit-status info" role="status" data-testid="status-edit-loading"><span className="pedit-skeleton" />Rendering original PDF pages locally…</div>}
    {error && <div className="pedit-status error" role="alert" data-testid="status-edit-error">{error}<button type="button" onClick={() => setError('')} aria-label="Dismiss error" data-testid="button-edit-dismiss-error"><X size={15} /></button></div>}
    {success && <div className="pedit-status success" role="status" data-testid="status-edit-success"><Check size={15} />{success}</div>}
    {editWarning && <div className="pedit-status warning" role="note" data-testid="status-edit-limitation">{editWarning}<button type="button" onClick={() => setEditWarning('')} aria-label="Dismiss note" data-testid="button-edit-dismiss-limitation"><X size={15} /></button></div>}
    <section className="pedit-workspace" aria-label="PDF page editor">
      <div className="pedit-toolbar">
        <div className="pedit-tools" role="toolbar" aria-label="Editing tools">
          <button type="button" className={tool === 'select' ? 'active' : ''} onClick={() => { setTool('select'); setPendingImage(null); }} data-testid="button-edit-tool-select"><MousePointer2 size={16} />Select</button>
          <button type="button" className={tool === 'text' ? 'active' : ''} onClick={() => { setTool('text'); setSelectedText(null); }} disabled={!pdf} data-testid="button-edit-add-text"><Type size={16} />Add text</button>
          <button type="button" className={tool === 'image' ? 'active' : ''} onClick={() => imageInput.current?.click()} disabled={!pdf} data-testid="button-edit-add-image"><ImagePlus size={16} />Add image</button>
          <button type="button" className={tool === 'erase' ? 'active' : ''} onClick={() => { setTool('erase'); setSelectedText(null); }} disabled={!pdf} data-testid="button-edit-erase-region"><FilePlus2 size={16} />Erase region</button>
        </div>
        <div className="pedit-controls">
          <button type="button" title="Undo" onClick={undo} disabled={!undoStack.length} data-testid="button-edit-undo"><Undo2 size={16} /></button>
          <button type="button" title="Redo" onClick={redo} disabled={!redoStack.length} data-testid="button-edit-redo"><Redo2 size={16} /></button>
          <span className="pedit-control-sep" />
          <button type="button" title="Zoom out" onClick={() => setZoom((value) => Math.max(.45, +(value - .1).toFixed(2)))} disabled={!pdf} data-testid="button-edit-zoom-out"><Minus size={15} /></button>
          <span className="pedit-zoom" data-testid="text-edit-zoom">{Math.round(zoom * 100)}%</span>
          <button type="button" title="Zoom in" onClick={() => setZoom((value) => Math.min(2, +(value + .1).toFixed(2)))} disabled={!pdf} data-testid="button-edit-zoom-in"><Plus size={15} /></button>
          <span className="pedit-control-sep" />
          <button type="button" onClick={() => navigateToPage(pageNumber - 1)} disabled={!pdf || pageNumber <= 1} aria-label="Previous page" data-testid="button-edit-previous-page"><ChevronLeft size={16} /></button>
          <label className="pedit-page-counter"><input type="number" min="1" max={pages.length || 1} value={pageNumber} disabled={!pdf} onChange={(event) => navigateToPage(Number(event.currentTarget.value) || 1)} data-testid="input-edit-page-number" /><span>/ {pages.length || 0}</span></label>
          <button type="button" onClick={() => navigateToPage(pageNumber + 1)} disabled={!pdf || pageNumber >= pages.length} aria-label="Next page" data-testid="button-edit-next-page"><ChevronRight size={16} /></button>
        </div>
      </div>
      <div className="pedit-tool-hint" role="status" data-testid="status-edit-tool">{tool === 'text' ? 'Add text is active — click the page to place a text box.' : tool === 'image' ? (pendingImage ? `Click the page to place ${pendingImage.name}.` : 'Choose an image to place.') : tool === 'erase' ? 'Click the content to cover it, then set the cover size. You can also replace that region with an image.' : selectedText ? 'Text selected — adjust its font, weight, colour, or size, then apply.' : 'Click original text or a previous replacement to edit its content and style.'}</div>
      {pdf ? <div className="pedit-stage" ref={stageRef} onScroll={(event) => {
        const stage = event.currentTarget;
        const center = stage.getBoundingClientRect().top + stage.clientHeight * 0.45;
        const candidates = Array.from(stage.querySelectorAll<HTMLElement>('[data-page-index]'));
        let closest = 0, distance = Number.POSITIVE_INFINITY;
        candidates.forEach((candidate, index) => {
          const bounds = candidate.getBoundingClientRect();
          const nextDistance = Math.abs((bounds.top + bounds.height / 2) - center);
          if (nextDistance < distance) { distance = nextDistance; closest = index + 1; }
        });
        if (closest && closest !== pageNumber) setPageNumber(closest);
      }} data-testid="canvas-edit-document">
        {pages.map((_, index) => <div className="pedit-page-shell" key={index} data-page-index={index + 1}>
          <div className="pedit-page-label"><span>PAGE {String(index + 1).padStart(2, '0')}</span>{index + 1 === pageNumber && <i>Current</i>}</div>
          <div className={`pedit-page-clickable${tool !== 'select' ? ' placing' : ''}`} onClick={(event) => void pageClick(event, index + 1)} data-testid={`surface-edit-page-${index + 1}`}>
            <PageCanvas document={pdf} pageNumber={index + 1} scale={zoom} onText={receiveText} />
          </div>
        </div>)}
      </div> : <div className="pedit-empty" data-testid="status-edit-empty">
        <div className="pedit-empty-icon"><FileText size={24} /></div><strong>Your page stays exactly where it is.</strong><p>Open a PDF to see its original rendered pages. Click text to edit it in place, or add text and images at precise page positions.</p>
        <button type="button" onClick={() => fileInput.current?.click()} data-testid="button-edit-empty-open"><Upload size={15} />Open a PDF</button>
      </div>}
      <footer className="pedit-statusbar">
        <span data-testid="text-edit-page-count">{pdf ? `${pageNumber} of ${pages.length} pages` : 'No document loaded'}</span>
        <span className="pedit-local"><i />Processed on this device</span>
      </footer>
    </section>
    {selectedEditId && (() => {
      const selected = edits.find((edit) => edit.id === selectedEditId);
      if (!selected) return null;
      return <aside className="pedit-selection-panel" aria-label="Selected edit controls" data-testid="panel-edit-selection">
        <div className="pedit-selection-title"><strong>{selected.kind === 'image' ? 'Placed image' : selected.kind === 'erase' ? 'Erase cover' : 'Added text'}</strong><button type="button" onClick={() => setSelectedEditId(null)} aria-label="Close selection controls" data-testid="button-edit-close-selection"><X size={15} /></button></div>
        {selected.kind === 'text' && <><label>Text<input autoFocus value={selected.text} onChange={(event) => updateSelected(selected.id, (edit) => ({ ...edit, text: event.currentTarget.value } as Edit))} data-testid="input-edit-added-text" /></label><label>Size (pt)<input type="number" min="6" max="96" value={selected.size} onChange={(event) => updateSelected(selected.id, (edit) => ({ ...edit, size: Math.min(96, Math.max(6, Number(event.currentTarget.value) || 12)) } as Edit))} data-testid="input-edit-added-text-size" /></label></>}
        {(selected.kind === 'image' || selected.kind === 'erase') && <><label>Width (pt)<input type="number" min="8" value={selected.width} onChange={(event) => updateSelected(selected.id, (edit) => ({ ...edit, width: Math.max(8, Number(event.currentTarget.value) || 8) } as Edit))} data-testid="input-edit-selected-width" /></label><label>Height (pt)<input type="number" min="8" value={selected.height} onChange={(event) => updateSelected(selected.id, (edit) => ({ ...edit, height: Math.max(8, Number(event.currentTarget.value) || 8) } as Edit))} data-testid="input-edit-selected-height" /></label></>}
        {selected.kind === 'image' && <><div className="pedit-selected-name">{selected.name}</div><button type="button" className="pedit-replace-image" onClick={() => imageInput.current?.click()} data-testid="button-edit-replace-image"><ImagePlus size={14} />Replace image</button></>}
        {selected.kind === 'erase' && <button type="button" className="pedit-replace-image" onClick={() => imageInput.current?.click()} data-testid="button-edit-replace-region"><ImagePlus size={14} />Replace region with image</button>}
        <button type="button" className="pedit-delete-selected" onClick={deleteSelected} data-testid="button-edit-delete-selected"><Trash2 size={14} />Delete selected edit</button>
        <small>Drag the item on the page to reposition it. Sizes are in PDF points.</small>
      </aside>;
    })()}
    {!textItems.length && pdf && !loading && <p className="pedit-scan-note" data-testid="status-edit-no-selectable-text">No selectable text detected yet. Scanned pages can still accept new text and images.</p>}
  </main>;
}

export default PdfEditPage;
