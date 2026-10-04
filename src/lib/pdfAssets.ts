// src/lib/pdfAssets.ts
//
// What the quote PDF needs beyond the quote itself (§94): the business's
// name, phone, GSTIN (only when the business chose to print it) and logo,
// and the embedded font.
//
// The font is the app's own, Plus Jakarta Sans, cut to a fixed Regular
// and Bold (jsPDF can't use the variable font) and to the characters a
// quote prints, about 22KB each (public/fonts, SIL OFL licence beside
// them). It's embedded because jsPDF's built-in Helvetica has no ₹ glyph
// and silently printed "¹" for it, which is why amounts said "Rs." until
// §94. If the font can't load, the PDF still generates, in Helvetica
// with "Rs."; a quote must never fail to go out over a font.

import type { BusinessProfile } from './businessProfile';

export interface PdfLogo {
  dataUrl: string;
  widthPx: number;
  heightPx: number;
}

export interface PdfBranding {
  name: string;
  phone: string;
  // Already filtered: set only when the business ticked "print GSTIN".
  gstin: string;
  logo: PdfLogo | null;
  // Base64 TTFs; null falls back to Helvetica and "Rs.".
  fonts: { regular: string; bold: string } | null;
}

// The logo's box in the PDF header, in points (A4 is 595 × 842).
export const LOGO_BOX_PT = { width: 120, height: 48 };

// Largest size that fits the box without stretching. A very small
// upload is scaled up to fill it too (uploads are kept at up to 600px,
// about 5× the box's width, so normal logos print sharp).
export function fitLogo(widthPx: number, heightPx: number, box = LOGO_BOX_PT): { width: number; height: number } {
  if (widthPx <= 0 || heightPx <= 0) return { width: 0, height: 0 };
  const k = Math.min(box.width / widthPx, box.height / heightPx);
  return { width: widthPx * k, height: heightPx * k };
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

let fontsPromise: Promise<PdfBranding['fonts']> | null = null;
function loadFonts(): Promise<PdfBranding['fonts']> {
  fontsPromise ??= Promise.all(
    ['/fonts/PlusJakartaSans-Regular-pdf.ttf', '/fonts/PlusJakartaSans-Bold-pdf.ttf'].map(async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(url);
      return toBase64(await res.arrayBuffer());
    })
  )
    .then(([regular, bold]) => ({ regular, bold }))
    .catch(() => {
      fontsPromise = null; // try again next time
      return null;
    });
  return fontsPromise;
}

async function loadLogo(url: string): Promise<PdfLogo | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    const size = { widthPx: bitmap.width, heightPx: bitmap.height };
    bitmap.close();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
    return { dataUrl, ...size };
  } catch {
    return null; // a missing logo leaves the header text-only
  }
}

export async function loadPdfBranding(profile: BusinessProfile | null): Promise<PdfBranding> {
  const [fonts, logo] = await Promise.all([loadFonts(), profile?.logoUrl ? loadLogo(profile.logoUrl) : Promise.resolve(null)]);
  return {
    name: profile?.name || 'Kitchen quote',
    phone: profile?.phone ?? '',
    gstin: profile?.showGstin ? profile.gstin : '',
    logo,
    fonts,
  };
}
