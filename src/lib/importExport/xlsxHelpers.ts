// src/lib/importExport/xlsxHelpers.ts
//
// Small, shared machinery for the catalogue Excel round trip
// (docs/PRINCIPLES.md, "Inventory import and export") — building a
// workbook Blob and reading one back into plain row objects, the
// per-cell validators every catalogue's own import module needs, and
// (once the cabinet pilot proved the shape) the id-match-key
// resolution and duplicate-id check every catalogue needs identically
// — every catalogue's sheet uses its own row's `id` as the match key
// (see cabinetImportExport.ts's header comment for why), so this part
// really is the same regardless of catalogue, unlike the field-by-
// field row shape, which stays concrete per catalogue rather than a
// generic "engine" over column specs.
//
// Uses the `xlsx` package (SheetJS) installed from cdn.sheetjs.com,
// NOT the npm registry build — npm's last-published `xlsx` (0.18.5)
// has two unpatched advisories (prototype pollution, ReDoS) with no
// fix on npm, and this feature's entire job is parsing a file a user
// uploads, which is exactly the surface those bugs are in. See
// package.json's dependency URL.

import * as XLSX from 'xlsx';

export interface SheetSpec {
  name: string;
  headers: string[];
  rows: Record<string, string | number>[];
}

export function buildWorkbookBlob(sheets: SheetSpec[]): Blob {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const worksheet = XLSX.utils.json_to_sheet(sheet.rows, { header: sheet.headers });
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name);
  }
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

// Reads the FIRST sheet only — the data sheet is always sheet one by
// convention in every export this builds; the Instructions sheet is
// second and never meant to be read back.
//
// `defval: ''` is what makes this safe to rely on: without it, a
// blank cell is simply ABSENT from the row object rather than an
// empty string, and every caller here (most importantly the blank-id-
// means-new-row rule) needs to be able to tell "blank" from "column
// doesn't exist in this row" — those are two different bugs otherwise.
export async function readFirstSheetRows(file: File): Promise<Record<string, string>[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  return XLSX.utils.sheet_to_json<Record<string, string>>(worksheet, {
    defval: '',
    raw: false, // stringify everything — a numeric cell should validate the same way whether it arrived typed as "600" or 600
  });
}

export interface FieldResult<T> {
  value: T;
  error?: string;
}

export function requiredString(value: string, fieldName: string): FieldResult<string> {
  const trimmed = value.trim();
  if (!trimmed) return { value: trimmed, error: `${fieldName} is required` };
  return { value: trimmed };
}

export function positiveNumber(value: string, fieldName: string): FieldResult<number> {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return { value: 0, error: `${fieldName} must be a positive number, got "${value}"` };
  }
  return { value: n };
}

// For fields where 0 is a real, legitimate value (an obstacle's
// elevation_mm off the floor, say) — positiveNumber would wrongly
// reject exactly the most common case for such a field.
export function nonNegativeNumber(value: string, fieldName: string): FieldResult<number> {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return { value: 0, error: `${fieldName} must be a number, 0 or more, got "${value}"` };
  }
  return { value: n };
}

// "yes"/"no" (also accepts "true"/"false") rather than Excel's own
// TRUE/FALSE checkbox cells — those round-trip as the literal strings
// "TRUE"/"FALSE" through sheet_to_json with raw:false anyway, so this
// covers both without the reader needing to know which one to type.
export function booleanValue(value: string, fieldName: string): FieldResult<boolean> {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'yes' || trimmed === 'true') return { value: true };
  if (trimmed === 'no' || trimmed === 'false') return { value: false };
  return { value: false, error: `${fieldName} must be "yes" or "no", got "${value}"` };
}

// Case-insensitive match against the allowed set, but returns the
// CANONICAL-cased value — a business typing "hdmr" in Excel shouldn't
// fail just because the app's own enum is "HDMR".
export function enumValue<T extends string>(
  value: string,
  fieldName: string,
  allowed: readonly T[]
): FieldResult<T | null> {
  const trimmed = value.trim();
  const match = allowed.find((candidate) => candidate.toLowerCase() === trimmed.toLowerCase());
  if (!match) {
    return {
      value: null,
      error: `${fieldName} must be one of: ${allowed.join(', ')} (got "${value}")`,
    };
  }
  return { value: match };
}

// Blank means "not set" (undefined), not an error — a handful of
// fields across the catalogues (a model path, a rotation correction,
// a sink cutout) are genuinely optional, unlike everything else this
// file validates.
export function optionalString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function optionalNumber(value: string, fieldName: string): FieldResult<number | undefined> {
  const trimmed = value.trim();
  if (!trimmed) return { value: undefined };
  const n = Number(trimmed);
  if (!Number.isFinite(n)) {
    return { value: undefined, error: `${fieldName} must be a number if set, got "${value}"` };
  }
  return { value: n };
}

export function numberInRange(
  value: string,
  fieldName: string,
  min: number,
  max: number
): FieldResult<number> {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    return { value: min, error: `${fieldName} must be a number from ${min} to ${max}, got "${value}"` };
  }
  return { value: n };
}

// #rgb / #rrggbb, case-insensitive — matches what the colour inputs
// elsewhere in this app already produce and accept.
export function hexColor(value: string, fieldName: string): FieldResult<string> {
  const trimmed = value.trim();
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed)) return { value: trimmed };
  return { value: '#000000', error: `${fieldName} must be a hex colour like #b8bcc0, got "${value}"` };
}

// The explicit delete mechanism every catalogue's sheet uses: typing
// "delete" (any case) in a dedicated column, rather than just removing
// the row — removing a row does nothing on commit (see resolveRowId's
// own comment), on purpose, because a row missing from the sheet is
// usually an accident (a filter left on, a row hidden, a sheet only
// partially filled in), while a business TYPING the word is a real,
// deliberate decision.
export const DELETE_MARKER_HEADER = 'delete';

export function isMarkedForDeletion(value: string): boolean {
  return value.trim().toLowerCase() === 'delete';
}

// A row marked for deletion is about to be removed, not saved — none
// of its OTHER field errors (a bad enum, a blank label) should block
// the commit, since fixing them would be pointless work on a row
// that's leaving anyway. The one thing that still has to be true is
// the id itself: deleting requires a REAL existing row to delete.
// Every catalogue's parser computes its full field-validation errors
// first (unchanged, so the non-deletion path stays exactly as it was)
// and calls this once at the end to cut that list down when deletion
// is what the row is actually asking for.
export function finalizeRowErrors(
  errors: string[],
  markedForDeletion: boolean,
  isNew: boolean
): string[] {
  if (!markedForDeletion) return errors;
  const idErrors = errors.filter(
    (e) => e.startsWith('Unknown id') || e.includes('appears on more than one row')
  );
  if (isNew) {
    idErrors.push(
      'Marked "delete" but there is no existing row to delete — leave the delete column blank for a new row.'
    );
  }
  return idErrors;
}

export interface ResolvedRowId {
  id: string;
  isNew: boolean;
  error?: string;
}

// The match-key rule every catalogue's sheet uses: blank id = insert
// new (fresh crypto.randomUUID()); present id = must match an
// existing row's id, or it's an error rather than a silent new-row
// fallback that would leave a business's typo unnoticed. `existingById`
// is keyed by id so each catalogue module builds it once, however its
// own row type is shaped.
export function resolveRowId(rawId: string, existingById: Map<string, unknown>): ResolvedRowId {
  const trimmed = rawId.trim();
  if (!trimmed) return { id: crypto.randomUUID(), isNew: true };
  if (existingById.has(trimmed)) return { id: trimmed, isNew: false };
  return {
    id: crypto.randomUUID(),
    isNew: true,
    error:
      `Unknown id "${trimmed}" — doesn't match any existing row. Leave this cell blank to add ` +
      `it as new, or fix the id back to what the original download had.`,
  };
}

// Two rows both citing the same EXISTING id would both try to update
// that one row — a plain upsert silently keeps whichever ends up last
// in the batch, and the other edit vanishes with no error. Mutates
// each affected row's `errors` array in place (matching how every
// catalogue's parser already accumulates errors per row) rather than
// returning a new structure the caller has to merge back in.
export function flagDuplicateMatchedIds<T extends { isNew: boolean; data: { id: string }; errors: string[] }>(
  rows: T[]
): void {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.isNew) counts.set(row.data.id, (counts.get(row.data.id) ?? 0) + 1);
  }
  for (const row of rows) {
    if (!row.isNew && (counts.get(row.data.id) ?? 0) > 1) {
      row.errors.push(
        'This id appears on more than one row in this sheet — only one would be kept. Remove ' +
          'the duplicate row, or clear its id to add it as new instead.'
      );
    }
  }
}
