import * as XLSX from 'xlsx';
import { DyeingBatch, DyeingAccessory } from '../types';

/**
 * Parser for fabric-level dyehouse Excel sheets (e.g. "TA_ماجنتا.xlsx").
 *
 * The sheet is organised in row pairs:
 *   - a COLOR row  (has a color name, ordered qty and/or color-approval code)
 *   - one or more ACCESSORY sub-rows that follow it (col A is a spec like
 *     "15% ريبس شتوي" and only the sent-qty column is filled). Accessories
 *     inherit the color row's shipment (same dispatch / date / dyehouse).
 *
 * Columns are matched by HEADER TEXT (not column letter) so that files with
 * extra / missing / reordered columns (12-col vs 14-col, broken #REF! columns)
 * all parse correctly.
 */

export interface ParsedAccessory {
  id: string;
  name: string;            // col A spec, e.g. "15% ريبس شتوي"
  sent: number;            // qty sent to dyehouse
  received: number;        // qty received back (col K, اجمالي الجاهز المستلم)
  rowIndex: number;        // original (1-based) excel row, for reference
}

export interface ParsedColor {
  id: string;
  color: string;             // col A
  colorHex: string;          // background fill colour of the color cell (best-effort, '' if none)
  quantity: number;          // ordered qty (الكمية)
  colorApproval: string;     // موافقة اللون (Pantone-style code)
  dyehouseColorName: string; // اسم اللون بالمصبغة
  rawDyehouse: string;       // توجية الخام لمصبغة — the raw text to be aliased
  dispatchNumber: string;    // رقم اذن الرسالة
  dateSent: string;          // التاريخ (ISO yyyy-mm-dd when parseable)
  quantitySent: number;      // الكمية المرسلة للمصبغة
  received: number;          // اجمالي الجاهز المستلم (col K) — 0 when none/broken
  formationDate: string;     // تاريخ التشكيل
  notes: string;             // ملاحظات
  receivedFlag: boolean;     // notes literally say "مستلم"
  accessories: ParsedAccessory[];
  rowIndex: number;          // original (1-based) excel row
}

export interface ParseResult {
  colors: ParsedColor[];
  sheetName: string;
  headerMap: Record<string, number>;               // field -> column index (auto + manual)
  headerRow: string[];                              // raw header cells as text
  unmatchedColumns: { index: number; text: string }[]; // header columns not mapped to any field
  distinctDyehouses: string[];                      // distinct raw dyehouse strings found
  warnings: string[];
  // Retained so the modal can re-parse when the user manually maps a column,
  // without re-reading the file / clipboard.
  rows?: any[][];
  colorGrid?: string[][];
}

// Fields the user is allowed to map manually (with friendly Arabic labels).
// 'remaining' is derived and 'color' is essential (already required to parse),
// so they're intentionally omitted from the manual-mapping picker.
export const MAPPABLE_FIELDS: { field: string; label: string }[] = [
  { field: 'quantity',          label: 'الكمية المطلوبة' },
  { field: 'colorApproval',     label: 'موافقة اللون' },
  { field: 'dyehouseColorName', label: 'اسم اللون بالمصبغة' },
  { field: 'rawDyehouse',       label: 'المصبغة' },
  { field: 'dispatchNumber',    label: 'رقم الاذن' },
  { field: 'dateSent',          label: 'تاريخ الإرسال' },
  { field: 'quantitySent',      label: 'الكمية المرسلة (مرسل)' },
  { field: 'formationDate',     label: 'تاريخ التشكيل' },
  { field: 'received',          label: 'المستلم (اجمالي الجاهز)' },
  { field: 'notes',             label: 'ملاحظات' },
];

// Field detection order matters: more specific headers are claimed first so a
// generic alias (e.g. "اللون") doesn't steal a specific column ("موافقة اللون").
const FIELD_ALIASES: { field: string; aliases: string[] }[] = [
  { field: 'colorApproval',     aliases: ['موافقه اللون', 'موافقة اللون'] },
  { field: 'dyehouseColorName', aliases: ['اسم اللون بالمصبغه', 'لون المصبغه'] },
  { field: 'rawDyehouse',       aliases: ['توجيه الخام', 'توجية الخام', 'المصبغه'] },
  { field: 'dispatchNumber',    aliases: ['رقم اذن', 'رقم الازن', 'اذن الرساله', 'رقم الاذن'] },
  { field: 'formationDate',     aliases: ['تاريخ التشكيل'] },
  { field: 'quantitySent',      aliases: ['الكميه المرسله', 'المرسله للمصبغه', 'مرسل'] },
  { field: 'received',          aliases: ['اجمالي الجاهز', 'الجاهز المستلم', 'المستلم', 'مستلم'] },
  { field: 'remaining',         aliases: ['المتبقي', 'متبقي'] },
  { field: 'dateSent',          aliases: ['تاريخ الارسال', 'التاريخ'] },
  { field: 'quantity',          aliases: ['الكميه', 'مطلوب'] },
  { field: 'notes',             aliases: ['ملاحظات', 'ملاحظه'] },
  { field: 'color',             aliases: ['اللون'] },
];

// Keywords that mark an accessory sub-row even without a leading percentage.
const ACCESSORY_KEYWORDS = ['ريبس', 'ريب', 'لايكرا', 'ليكرا', 'داربي', 'دانتيل', 'اكسسوار', 'كولbattoni'];

/** Normalise Arabic text for tolerant matching. */
function normalizeAr(input: any): string {
  let s = String(input ?? '');
  // strip diacritics & tatweel
  s = s.replace(/[ً-ْـ]/g, '');
  // unify alef / ya / ta-marbuta forms
  s = s.replace(/[آأإ]/g, 'ا') // آأإ -> ا
       .replace(/ى/g, 'ي')               // ى -> ي
       .replace(/ة/g, 'ه')               // ة -> ه
       .replace(/[ؤ]/g, 'و')             // ؤ -> و
       .replace(/[ئ]/g, 'ي');            // ئ -> ي
  // drop trailing digits some headers carry (e.g. "موافقة اللون1")
  s = s.replace(/\d+\s*$/, '');
  return s.replace(/\s+/g, ' ').trim();
}

const MONTH_NAMES: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

/**
 * Recognise day/month text with no year (e.g. "25-Jun", "Jun 3", "18/Jun") —
 * the format Excel *displays* dates as, which is all a clipboard paste carries
 * (unlike a file upload, which gets the real underlying date serial number).
 * The year is unknowable from the text alone, so it's assumed to be the
 * current year.
 */
function parseTextDate(raw: string): string {
  const s = raw.trim().replace(/\.$/, '');
  const year = new Date().getFullYear();
  const tryBuild = (mon: number, day: number): string => {
    if (mon === undefined || !day || day < 1 || day > 31) return '';
    const d = new Date(Date.UTC(year, mon, day));
    // Reject impossible dates (e.g. day 31 in a 30-day month) instead of silently rolling over
    if (d.getUTCMonth() !== mon || d.getUTCDate() !== day) return '';
    return d.toISOString().split('T')[0];
  };
  let m = s.match(/^(\d{1,2})[\s\-\/]+([A-Za-z]{3,9})$/); // "25-Jun", "25/Jun", "3 June"
  if (m) return tryBuild(MONTH_NAMES[m[2].toLowerCase()], parseInt(m[1], 10));
  m = s.match(/^([A-Za-z]{3,9})[\s\-\/]+(\d{1,2})$/); // "Jun-25", "Jun 3"
  if (m) return tryBuild(MONTH_NAMES[m[1].toLowerCase()], parseInt(m[2], 10));
  return '';
}

/** Convert an Excel cell value to an ISO date string when possible. */
function parseDate(val: any): string {
  if (val === null || val === undefined || val === '') return '';
  if (typeof val === 'number') {
    const date = new Date(Math.round((val - 25569) * 86400 * 1000));
    if (!isNaN(date.getTime())) return date.toISOString().split('T')[0];
  }
  const s = String(val).trim();
  if (s.startsWith('#')) return ''; // ignore formula errors
  const textDate = parseTextDate(s);
  if (textDate) return textDate;
  return s; // unrecognised format — left as-is, still editable manually in review
}

/** Numeric value from a cell (rounded to 2 decimals), errors / blanks as 0. */
function num(val: any): number {
  if (val === null || val === undefined || val === '') return 0;
  const n = Number(String(val).replace(/,/g, '').trim());
  return isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function cleanStr(val: any): string {
  const s = String(val ?? '').trim();
  return s.startsWith('#') ? '' : s; // hide #REF! etc.
}

/**
 * Best-effort read of a cell's solid background fill colour as #RRGGBB.
 * Only handles direct RGB fills (the common case for manually-coloured cells);
 * theme/indexed colours are skipped and return ''. Requires the workbook to be
 * read with { cellStyles: true }.
 */
function cellFillHex(sheet: XLSX.WorkSheet, r: number, c: number): string {
  const addr = XLSX.utils.encode_cell({ r, c });
  const cell: any = (sheet as any)[addr];
  const rgb = cell?.s?.fgColor?.rgb ?? cell?.s?.bgColor?.rgb;
  if (!rgb || typeof rgb !== 'string') return '';
  const hex = rgb.length >= 6 ? rgb.slice(-6) : '';
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return '';
  const up = hex.toUpperCase();
  if (up === 'FFFFFF' || up === '000000') return ''; // ignore plain white/black (usually "no fill")
  return '#' + up;
}

function isAccessoryName(raw: string): boolean {
  const s = raw.trim();
  if (/^\d+(?:[.,]\d+)?\s*%/.test(s)) return true; // leading percentage
  const n = normalizeAr(s);
  return ACCESSORY_KEYWORDS.some(k => n.includes(normalizeAr(k)));
}

/** Build a field -> column index map from a header row. */
function buildHeaderMap(headerRow: any[]): Record<string, number> {
  const norm = headerRow.map(c => normalizeAr(c));
  const map: Record<string, number> = {};
  const taken = new Set<number>();
  for (const { field, aliases } of FIELD_ALIASES) {
    let foundIdx = -1;
    // prefer exact-ish match, then substring
    for (const alias of aliases) {
      const a = normalizeAr(alias);
      const exact = norm.findIndex((h, i) => !taken.has(i) && h === a);
      if (exact !== -1) { foundIdx = exact; break; }
      const partial = norm.findIndex((h, i) => !taken.has(i) && h.includes(a));
      if (partial !== -1) { foundIdx = partial; break; }
    }
    if (foundIdx !== -1) { map[field] = foundIdx; taken.add(foundIdx); }
  }
  return map;
}

/** Locate the header row within the first few rows of the sheet. */
function findHeaderRow(rows: any[][]): number {
  const limit = Math.min(rows.length, 8);
  let best = -1, bestScore = 0;
  for (let i = 0; i < limit; i++) {
    const map = buildHeaderMap(rows[i] || []);
    const score = Object.keys(map).length;
    // a valid header must at least find the color column plus a couple others
    if (score > bestScore && map.color !== undefined && score >= 3) {
      bestScore = score; best = i;
    }
  }
  return best;
}

/**
 * The shared parsing core. Works on a plain 2D array of cell values, so it is
 * completely agnostic to the source (xlsx file OR pasted clipboard cells).
 * `colorGrid[r][c]` optionally supplies each cell's background fill (#RRGGBB).
 * `overrides` are manual field->column assignments (from the "link columns" UI)
 * that win over auto-detection, so no column is ever silently dropped.
 */
export function parseDyehouseRows(
  rows: any[][],
  colorGrid?: string[][],
  overrides?: Record<string, number>,
  sheetName = 'مُلصق',
): ParseResult {
  const warnings: string[] = [];
  const headerIdx = findHeaderRow(rows);
  if (headerIdx === -1) {
    return { colors: [], sheetName, headerMap: {}, headerRow: [], unmatchedColumns: [], distinctDyehouses: [], warnings: ['لم يتم العثور على صف العناوين (تأكد من نسخ صف العناوين: اللون، الكميه، ...).'] };
  }
  const headerMap = buildHeaderMap(rows[headerIdx]);
  // Apply manual overrides: a chosen column is freed from any auto-match, then
  // assigned to the requested field (or removed when index < 0).
  if (overrides) {
    for (const [field, idx] of Object.entries(overrides)) {
      if (idx === undefined || idx === null || idx < 0) { delete headerMap[field]; continue; }
      for (const f of Object.keys(headerMap)) if (headerMap[f] === idx) delete headerMap[f];
      headerMap[field] = idx;
    }
  }
  const col = (f: string) => (headerMap[f] !== undefined ? headerMap[f] : -1);
  const cell = (row: any[], f: string) => { const i = col(f); return i === -1 ? '' : row[i]; };

  const colors: ParsedColor[] = [];
  let current: ParsedColor | null = null;

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const rowIndex = r + 1; // 1-based excel row
    const nameRaw = cleanStr(cell(row, 'color'));
    const sent = num(cell(row, 'quantitySent'));
    const ordered = num(cell(row, 'quantity'));
    const received = num(cell(row, 'received'));

    // Skip rows with no color name and no quantity (blank or dragged #REF! fill)
    if (!nameRaw && sent === 0 && ordered === 0 && received === 0) continue;

    if (nameRaw && isAccessoryName(nameRaw)) {
      // Accessory sub-row -> attach to the current color
      if (!current) {
        warnings.push(`صف ${rowIndex}: اكسسوار "${nameRaw}" بدون لون سابق — تم تجاهله.`);
        continue;
      }
      current.accessories.push({ id: crypto.randomUUID(), name: nameRaw, sent, received, rowIndex });
      continue;
    }

    if (!nameRaw) {
      // Has a quantity but no name — likely a stray accessory line; attach to current.
      if (current && (sent > 0 || received > 0)) {
        current.accessories.push({ id: crypto.randomUUID(), name: 'اكسسوار', sent, received, rowIndex });
      }
      continue;
    }

    // New color row
    const notes = cleanStr(cell(row, 'notes'));
    const colorCol = col('color');
    current = {
      id: crypto.randomUUID(),
      color: nameRaw,
      colorHex: (colorGrid && colorCol !== -1) ? (colorGrid[r]?.[colorCol] || '') : '',
      quantity: ordered,
      colorApproval: cleanStr(cell(row, 'colorApproval')),
      dyehouseColorName: cleanStr(cell(row, 'dyehouseColorName')),
      rawDyehouse: cleanStr(cell(row, 'rawDyehouse')),
      dispatchNumber: cleanStr(cell(row, 'dispatchNumber')),
      dateSent: parseDate(cell(row, 'dateSent')),
      quantitySent: sent,
      received,
      formationDate: parseDate(cell(row, 'formationDate')),
      notes,
      receivedFlag: normalizeAr(notes).includes(normalizeAr('مستلم')),
      accessories: [],
      rowIndex,
    };
    colors.push(current);
  }

  const distinctDyehouses = Array.from(
    new Set(colors.map(c => c.rawDyehouse).filter(Boolean))
  );

  // Header columns that carry text but weren't mapped to any field — these are
  // the candidates the user can hand-assign so their data isn't dropped.
  const headerRow = (rows[headerIdx] || []).map(x => String(x ?? '').trim());
  const usedCols = new Set(Object.values(headerMap));
  const unmatchedColumns = headerRow
    .map((text, index) => ({ index, text }))
    .filter(c => c.text !== '' && !usedCols.has(c.index));

  return { colors, sheetName, headerMap, headerRow, unmatchedColumns, distinctDyehouses, warnings };
}

/** Build a full [row][col] grid of cell fill colours for an xlsx sheet. */
function buildSheetColorGrid(sheet: XLSX.WorkSheet, rows: any[][]): string[][] {
  const maxCols = rows.reduce((m, r) => Math.max(m, r?.length || 0), 0);
  return rows.map((_row, ri) => {
    const arr: string[] = [];
    for (let c = 0; c < maxCols; c++) arr.push(cellFillHex(sheet, ri, c));
    return arr;
  });
}

/** Parse an uploaded .xlsx file (reads bytes -> rows + colour grid, then the core). */
export function parseDyehouseWorkbook(data: ArrayBuffer | Uint8Array | string): ParseResult {
  const workbook = XLSX.read(data, { type: typeof data === 'string' ? 'binary' : 'array', cellStyles: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' }) as any[][];
  const colorGrid = buildSheetColorGrid(sheet, rows);
  const res = parseDyehouseRows(rows, colorGrid, undefined, sheetName);
  if (res.colors.length === 0 && res.warnings.length && res.warnings[0].includes('صف العناوين')) {
    res.warnings = ['لم يتم العثور على صف العناوين في الملف.'];
  }
  res.rows = rows;
  res.colorGrid = colorGrid;
  return res;
}

// ─── Clipboard (paste-from-Excel) support ───────────────────────────────────

/** Normalise a CSS colour value to #RRGGBB, or '' if not a usable solid colour. */
function cssColorToHex(val: string): string {
  if (!val) return '';
  const v = val.trim().toLowerCase();
  let hex = '';
  const hexM = v.match(/#([0-9a-f]{6})\b/);
  if (hexM) hex = hexM[1];
  else {
    const rgbM = v.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (rgbM) hex = [rgbM[1], rgbM[2], rgbM[3]].map(n => Number(n).toString(16).padStart(2, '0')).join('');
  }
  if (!/^[0-9a-f]{6}$/.test(hex)) return '';
  const up = hex.toUpperCase();
  if (up === 'FFFFFF' || up === '000000') return ''; // treat plain white/black as "no fill"
  return '#' + up;
}

/** Excel pastes colours as `.className { background: #.. }` in a <style> block. */
function parseStyleClassColors(styleText: string): Record<string, string> {
  const map: Record<string, string> = {};
  const ruleRe = /\.([\w-]+)\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = ruleRe.exec(styleText))) {
    const bgM = m[2].match(/background(?:-color)?\s*:\s*([^;]+)/i);
    if (bgM) { const hex = cssColorToHex(bgM[1]); if (hex) map[m[1]] = hex; }
  }
  return map;
}

/**
 * Parse cells copied from Excel/Sheets. Prefers the clipboard's HTML (keeps the
 * table structure AND the cells' rendered background colours); falls back to the
 * tab-separated plain text. Feeds the exact same parsing core as the file import.
 */
export function parseDyehousePaste(html: string, text: string): ParseResult {
  if (html && /<table/i.test(html)) {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const table = doc.querySelector('table');
      if (table) {
        const classColors = parseStyleClassColors(doc.querySelector('style')?.textContent || '');
        const rows: string[][] = [];
        const colorGrid: string[][] = [];
        table.querySelectorAll('tr').forEach(tr => {
          const cells: string[] = [];
          const cols: string[] = [];
          tr.querySelectorAll('td,th').forEach(td => {
            const el = td as HTMLElement;
            cells.push((el.textContent || '').replace(/ /g, ' ').trim());
            let hex = cssColorToHex(el.style?.background || el.style?.backgroundColor || '');
            if (!hex) for (const cls of Array.from(el.classList)) { if (classColors[cls]) { hex = classColors[cls]; break; } }
            if (!hex) hex = cssColorToHex(el.getAttribute('bgcolor') || '');
            cols.push(hex);
          });
          if (cells.length) { rows.push(cells); colorGrid.push(cols); }
        });
        if (rows.length) {
          const res = parseDyehouseRows(rows, colorGrid, undefined, 'مُلصق');
          res.rows = rows;
          res.colorGrid = colorGrid;
          return res;
        }
      }
    } catch { /* fall through to plain-text */ }
  }
  // Plain-text TSV fallback (no colours)
  const rows = (text || '').replace(/\r/g, '').split('\n').map(line => line.split('\t'));
  const trimmed = rows.filter(r => r.some(c => (c ?? '').trim() !== ''));
  if (!trimmed.length) {
    return { colors: [], sheetName: 'مُلصق', headerMap: {}, headerRow: [], unmatchedColumns: [], distinctDyehouses: [], warnings: ['لم يتم لصق أي بيانات. انسخ الخلايا من إكسل ثم ألصقها.'] };
  }
  const res = parseDyehouseRows(trimmed, undefined, undefined, 'مُلصق');
  res.rows = trimmed;
  return res;
}

// ─── Reconciliation — matching a re-pasted sheet against colors that already
//     exist on the order, so paste can both ADD new colors and UPDATE
//     existing ones (safe whether the whole sheet or just a few rows are
//     pasted; nothing already recorded is ever removed or silently clobbered).
// ─────────────────────────────────────────────────────────────────────────

export type MatchState = 'new' | 'update' | 'unchanged' | 'conflict';

export interface AccessoryDiff {
  name: string;
  existingId?: string;   // set if matched to an existing accessory (SET, not delta)
  sent: number;          // new total to apply
  received: number;      // new total to apply
  sentChanged: boolean;
  receivedChanged: boolean;
  isNew: boolean;
}

export interface ReconcileDiff {
  sentDelta: number;       // amount to add as a new SentEvent (raw); negative only when accepted as a correction
  receivedDelta: number;   // amount to add as a new ReceiveEvent (raw); negative only when accepted as a correction
  accessoryDiffs: AccessoryDiff[];
  fillsDispatch: boolean;  // existing batch has no dispatch number; this paste supplies one
  fillsDate: boolean;      // existing batch has no dateSent; this paste supplies one
  fillsFormationDate: boolean;
  fillsApproval: boolean;
  fillsNotes: boolean;
  hasDecrease: boolean;    // sentDelta/receivedDelta/any accessory delta is negative
}

export interface ReconciledRow {
  parsed: ParsedColor;
  state: MatchState;
  matchedBatchId?: string;         // set for 'update' / 'unchanged'
  candidates?: DyeingBatch[];      // set when state === 'conflict' && conflictReason === 'ambiguous'
  conflictReason?: 'ambiguous' | 'decrease';
  diff?: ReconcileDiff;
}

const closeEnough = (a: number, b: number) => Math.abs((a || 0) - (b || 0)) < 0.01;

function existingSentRaw(b: DyeingBatch): number {
  const events = (b.sentEvents || []).reduce((s, e) => s + (Number(e.quantity) || 0), 0);
  return events + (Number(b.quantitySentRaw) || Number(b.quantitySent) || 0);
}
function existingReceivedRaw(b: DyeingBatch): number {
  const events = (b.receiveEvents || []).reduce((s, e) => s + (Number(e.quantityRaw) || 0), 0);
  return events + (Number(b.receivedQuantity) || 0);
}

function diffAccessories(parsedAccs: ParsedAccessory[], existingAccs: DyeingAccessory[]): AccessoryDiff[] {
  return parsedAccs.map(pa => {
    const paName = normalizeAr(pa.name);
    const existing = existingAccs.find(ea => normalizeAr(ea.name) === paName);
    if (!existing) {
      return { name: pa.name, sent: pa.sent || 0, received: pa.received || 0, sentChanged: (pa.sent || 0) > 0, receivedChanged: (pa.received || 0) > 0, isNew: true };
    }
    return {
      name: pa.name,
      existingId: existing.id,
      sent: pa.sent || 0,
      received: pa.received || 0,
      sentChanged: !closeEnough(pa.sent || 0, existing.sent || 0),
      receivedChanged: !closeEnough(pa.received || 0, existing.received || 0),
      isNew: false,
    };
  });
}

// Exported so the modal can (re)compute a diff against a specific batch —
// needed when the user manually resolves an ambiguous match, since that
// candidate's diff wasn't precomputed by reconcileParsedColors.
export function computeReconcileDiff(p: ParsedColor, batch: DyeingBatch): ReconcileDiff {
  const sentDelta = Math.round(((p.quantitySent || 0) - existingSentRaw(batch)) * 100) / 100;
  const receivedDelta = Math.round(((p.received || 0) - existingReceivedRaw(batch)) * 100) / 100;
  const accessoryDiffs = diffAccessories(p.accessories, batch.accessories || []);
  // An accessory "decrease" means its new total is lower than what's on record.
  const accHasDecrease = accessoryDiffs.some(a => {
    if (a.isNew) return false;
    const existing = (batch.accessories || []).find(ea => ea.id === a.existingId);
    if (!existing) return false;
    return (a.sentChanged && a.sent < (existing.sent || 0)) || (a.receivedChanged && a.received < (existing.received || 0));
  });
  return {
    sentDelta,
    receivedDelta,
    accessoryDiffs,
    fillsDispatch: !((batch.dispatchNumber || '').trim()) && !!(p.dispatchNumber || '').trim(),
    fillsDate: !((batch.dateSent || '').trim()) && !!(p.dateSent || '').trim(),
    fillsFormationDate: !((batch.formationDate || '').trim()) && !!(p.formationDate || '').trim(),
    fillsApproval: !((batch.colorApproval || '').trim()) && !!(p.colorApproval || '').trim(),
    fillsNotes: !((batch.notes || '').trim()) && !!(p.notes || '').trim(),
    hasDecrease: sentDelta < -0.01 || receivedDelta < -0.01 || accHasDecrease,
  };
}

function diffIsNoop(diff: ReconcileDiff): boolean {
  return closeEnough(diff.sentDelta, 0) && closeEnough(diff.receivedDelta, 0)
    && !diff.fillsDispatch && !diff.fillsDate && !diff.fillsFormationDate && !diff.fillsApproval && !diff.fillsNotes
    && diff.accessoryDiffs.every(a => !a.isNew && !a.sentChanged && !a.receivedChanged);
}

/**
 * Match freshly-parsed rows against an order's existing dyeing batches.
 *
 *  1. Exact  — same color + same non-empty dispatch number  -> update that batch.
 *  2. Placeholder — pasted row has a dispatch number that matches nothing, but
 *     exactly one existing batch of that color is still un-dispatched (blank
 *     dispatchNumber) -> that "planned" row is now being dispatched; fill it in
 *     rather than creating a duplicate.
 *  3. Blank dedup — pasted row also has no dispatch number yet; matches an
 *     existing blank-dispatch batch of the same color the same way (handles
 *     re-pasting the same still-pending row without duplicating it).
 *  4. No candidate -> new color.
 *  5. More than one candidate in (2)/(3) -> ambiguous, left for the user to
 *     resolve rather than guessed at.
 *
 * A batch can only be claimed by one pasted row per pass, so two different
 * pasted rows can never silently collide on the same existing batch.
 */
export function reconcileParsedColors(parsedColors: ParsedColor[], existingBatches: DyeingBatch[]): ReconciledRow[] {
  const claimed = new Set<string>();
  const results: ReconciledRow[] = [];

  for (const p of parsedColors) {
    const pColorNorm = normalizeAr(p.color);
    const pDispatch = (p.dispatchNumber || '').trim();

    let matched: DyeingBatch | undefined = pDispatch
      ? existingBatches.find(b => !claimed.has(b.id) && normalizeAr(b.color) === pColorNorm && (b.dispatchNumber || '').trim() === pDispatch)
      : undefined;

    if (!matched) {
      const candidates = existingBatches.filter(b =>
        !claimed.has(b.id) && normalizeAr(b.color) === pColorNorm && !(b.dispatchNumber || '').trim()
      );
      if (candidates.length === 1) {
        matched = candidates[0];
      } else if (candidates.length > 1) {
        results.push({ parsed: p, state: 'conflict', conflictReason: 'ambiguous', candidates });
        continue;
      }
    }

    if (!matched) {
      results.push({ parsed: p, state: 'new' });
      continue;
    }

    claimed.add(matched.id);
    const diff = computeReconcileDiff(p, matched);
    if (diff.hasDecrease) {
      results.push({ parsed: p, state: 'conflict', conflictReason: 'decrease', matchedBatchId: matched.id, diff });
    } else if (diffIsNoop(diff)) {
      results.push({ parsed: p, state: 'unchanged', matchedBatchId: matched.id, diff });
    } else {
      results.push({ parsed: p, state: 'update', matchedBatchId: matched.id, diff });
    }
  }

  return results;
}
