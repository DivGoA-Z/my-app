// src/lib/businessProfile.ts
//
// The business details printed on the quote PDF (§94): name, phone,
// logo, and GSTIN with a per-business choice to print it. Until §94 the
// PDF read its name and phone from `.env` (VITE_BUSINESS_NAME), so the
// name set in Settings never reached a customer, and two businesses on
// one deployment would both print whatever `.env` said.
//
// Reads tolerate a database that hasn't had schema.sql re-run yet: the
// new columns missing is reported (`columnsMissing`) rather than
// breaking sign-in, and the name still loads.

import { supabase } from './Supabaseclient';

export interface BusinessProfile {
  name: string;
  phone: string;
  logoUrl: string | null;
  gstin: string;
  showGstin: boolean;
  // The database lacks §94's columns: schema.sql needs re-running.
  columnsMissing?: boolean;
}

// ---- GSTIN ----

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
// 2-digit state code, 10-character PAN, entity number, 'Z', check char.
const GSTIN_SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function normaliseGstin(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

// The 15th character is a check digit over the first 14 (the GSTN's
// published mod-36 scheme), so a single mistyped character is caught
// before it's printed on a customer's quote.
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = GSTIN_CHARS.indexOf(first14[i]);
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36];
}

export function gstinProblem(raw: string): string | null {
  const g = normaliseGstin(raw);
  if (!g) return null; // empty is allowed: not every business has one
  if (g.length !== 15) return `A GSTIN has 15 characters; this has ${g.length}.`;
  if (!GSTIN_SHAPE.test(g)) return 'That doesn’t look like a GSTIN (state code, PAN, then 3 more).';
  if (gstinCheckChar(g.slice(0, 14)) !== g[14]) return 'The last character doesn’t match: check for a typo.';
  return null;
}

// ---- Supabase ----

export async function fetchBusinessProfile(businessId: string): Promise<BusinessProfile | null> {
  const full = await supabase
    .from('businesses')
    .select('name, phone, logo_url, gstin, show_gstin')
    .eq('id', businessId)
    .maybeSingle();
  if (!full.error) {
    const r = full.data as { name?: string; phone?: string | null; logo_url?: string | null; gstin?: string | null; show_gstin?: boolean } | null;
    if (!r) return null;
    return { name: r.name ?? '', phone: r.phone ?? '', logoUrl: r.logo_url ?? null, gstin: r.gstin ?? '', showGstin: r.show_gstin ?? false };
  }
  // Most likely the §94 columns aren't there yet; the name still is.
  const basic = await supabase.from('businesses').select('name').eq('id', businessId).maybeSingle();
  const name = (basic.data as { name?: string } | null)?.name;
  if (name === undefined) return null;
  return { name, phone: '', logoUrl: null, gstin: '', showGstin: false, columnsMissing: true };
}

const NOT_SAVED = 'Not saved: re-run supabase/schema.sql (it adds the phone, logo and GSTIN columns).';

export async function saveBusinessProfile(
  businessId: string,
  patch: Partial<Pick<BusinessProfile, 'name' | 'phone' | 'gstin' | 'showGstin' | 'logoUrl'>>
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name.trim();
  if (patch.phone !== undefined) row.phone = patch.phone.trim() || null;
  if (patch.gstin !== undefined) row.gstin = normaliseGstin(patch.gstin) || null;
  if (patch.showGstin !== undefined) row.show_gstin = patch.showGstin;
  if (patch.logoUrl !== undefined) row.logo_url = patch.logoUrl;
  const { data, error } = await supabase.from('businesses').update(row).eq('id', businessId).select('id');
  if (error) throw new Error(/column/i.test(error.message) ? NOT_SAVED : error.message);
  // RLS refuses an update as "0 rows", not as an error.
  if (!data || data.length === 0) throw new Error(NOT_SAVED);
}

const LOGO_BUCKET = 'business-logos';
// Big enough to print sharply at the PDF's ~120 × 48pt logo box (about
// 2.5× its size), small enough that a phone photo doesn't bloat every
// quote PDF it goes into.
export const LOGO_MAX_PX = { width: 600, height: 300 };

// Shrinks the picture to LOGO_MAX_PX as a PNG (keeps a transparent
// background transparent) before upload.
async function shrinkLogo(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const k = Math.min(1, LOGO_MAX_PX.width / bitmap.width, LOGO_MAX_PX.height / bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * k));
  canvas.height = Math.max(1, Math.round(bitmap.height * k));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Couldn’t read that image.'))), 'image/png')
  );
}

// Uploads a new logo into the business's own folder and records its
// URL. A new file name each time, so a cached old logo never shows; the
// previous file is removed afterwards (best effort).
export async function uploadBusinessLogo(businessId: string, file: File, previousUrl: string | null): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Use a PNG or JPG image.');
  const blob = await shrinkLogo(file);
  const path = `${businessId}/logo-${Date.now()}.png`;
  const { error } = await supabase.storage.from(LOGO_BUCKET).upload(path, blob, { contentType: 'image/png', upsert: false });
  if (error) throw new Error(/bucket/i.test(error.message) ? NOT_SAVED : error.message);
  const url = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path).data.publicUrl;
  await saveBusinessProfile(businessId, { logoUrl: url });
  if (previousUrl) void deleteLogoFile(previousUrl);
  return url;
}

export async function removeBusinessLogo(businessId: string, currentUrl: string | null): Promise<void> {
  await saveBusinessProfile(businessId, { logoUrl: null });
  if (currentUrl) void deleteLogoFile(currentUrl);
}

async function deleteLogoFile(url: string) {
  const marker = `/${LOGO_BUCKET}/`;
  const i = url.indexOf(marker);
  if (i < 0) return;
  await supabase.storage.from(LOGO_BUCKET).remove([url.slice(i + marker.length)]);
}
