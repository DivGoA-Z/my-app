// src/lib/quotePdfStorage.ts
//
// Uploads a quote PDF (lib/quotePdf.ts) to the `quote-pdfs` Supabase
// Storage bucket (see the storage section of supabase/schema.sql) and
// returns its public URL, ready to embed in a WhatsApp message
// (lib/whatsapp.ts).
//
// Path is deterministic (`${projectId}/v${version}.pdf`) and always
// uploaded with upsert — a frozen quote's summary/pricingContext never
// change (types/quote.ts), so regenerating from them always reproduces
// the same document. There is nothing to version here beyond the
// quote's own version number, and nothing to invalidate.

import { supabase } from './Supabaseclient';

const QUOTE_PDF_BUCKET = 'quote-pdfs';

function quotePdfStoragePath(projectId: string, version: number): string {
  return `${projectId}/v${version}.pdf`;
}

export async function uploadQuotePdf(
  projectId: string,
  version: number,
  blob: Blob
): Promise<string> {
  const path = quotePdfStoragePath(projectId, version);

  const { error } = await supabase.storage.from(QUOTE_PDF_BUCKET).upload(path, blob, {
    contentType: 'application/pdf',
    upsert: true,
  });
  if (error) {
    throw new Error(`Failed to upload quote PDF: ${error.message}`);
  }

  const { data } = supabase.storage.from(QUOTE_PDF_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
