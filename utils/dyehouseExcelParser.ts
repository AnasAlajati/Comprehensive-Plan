import * as XLSX from 'xlsx';

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
  headerMap: Record<string, number>; // field -> column index (for debugging)
  distinctDyehouses: string[];        // distinct raw dyehouse strings found
  warnings: string[];
}

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

/** Convert an Excel cell value to an ISO date string when possible. */
function parseDate(val: any): string {
  if (val === null || val === undefined || val === '') return '';
  if (typeof val === 'number') {
    const date = new Date(Math.round((val - 25569) * 86400 * 1000));
    if (!isNaN(date.getTime())) return date.toISOString().split('T')[0];
  }
  const s = String(val).trim();
  return s.startsWith('#') ? '' : s; // ignore formula errors
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

export function parseDyehouseWorkbook(data: ArrayBuffer | Uint8Array | string): ParseResult {
  const workbook = XLSX.read(data, { type: typeof data === 'string' ? 'binary' : 'array', cellStyles: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' }) as any[][];

  const warnings: string[] = [];
  const headerIdx = findHeaderRow(rows);
  if (headerIdx === -1) {
    return { colors: [], sheetName, headerMap: {}, distinctDyehouses: [], warnings: ['لم يتم العثور على صف العناوين في الملف.'] };
  }
  const headerMap = buildHeaderMap(rows[headerIdx]);
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
    current = {
      id: crypto.randomUUID(),
      color: nameRaw,
      colorHex: cellFillHex(sheet, r, col('color')),
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

  return { colors, sheetName, headerMap, distinctDyehouses, warnings };
}
