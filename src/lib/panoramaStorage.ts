// src/lib/panoramaStorage.ts
//
// Uploads a captured panorama Blob (lib/panoramaCapture.ts) to the
// `panoramas` Supabase Storage bucket (see the storage section of
// supabase/schema.sql for the bucket + its policies) and returns the
// resulting public URL, ready to hand to
// layoutStore.capturePanoramaForCamera / PanoramaViewerModal.tsx.
//
// Deliberately its own tiny file rather than folded into lib/Inventory.ts
// or lib/Persistence.ts — this talks to Supabase STORAGE, not a
// database table, which is a different client API
// (supabase.storage.from(...) vs supabase.from(...)).

import { supabase } from './Supabaseclient';

const PANORAMA_BUCKET = 'panoramas';

// One object per Camera Node, keyed by layout + camera id so a
// re-capture overwrites (upsert: true below) the same node's previous
// panorama rather than accumulating stale copies. Under the business's
// own folder (§107): storage only lets a member write there.
export function panoramaStoragePath(businessId: string, layoutId: string, cameraId: string): string {
  return `${businessId}/${layoutId}/${cameraId}.jpg`;
}

export async function uploadPanorama(
  businessId: string,
  layoutId: string,
  cameraId: string,
  blob: Blob
): Promise<string> {
  const path = panoramaStoragePath(businessId, layoutId, cameraId);

  const { error: uploadError } = await supabase.storage.from(PANORAMA_BUCKET).upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: true,
    // Short TTL instead of Supabase's default (3600s). The ?v= param
    // below is the real cache-buster, but this also keeps the CDN from
    // holding a stale copy for anyone who somehow lands on the bare
    // URL without it.
    cacheControl: '60',
  });
  if (uploadError) {
    throw new Error(`Failed to upload panorama: ${uploadError.message}`);
  }

  const { data } = supabase.storage.from(PANORAMA_BUCKET).getPublicUrl(path);

  // CACHE-BUSTING — this matters more than it looks. Because the
  // storage path is stable per camera node and we upsert in place, a
  // re-capture produces a byte-identical public URL. Both the browser
  // and Supabase's CDN happily serve the PREVIOUS image for that URL,
  // so re-capturing appears to do nothing at all: you keep seeing the
  // old panorama and conclude the capture code didn't change, when in
  // fact the new image uploaded fine and was never fetched. Appending
  // a unique version param makes each capture a distinct URL to any
  // cache while still pointing at the same underlying object (so
  // deletePanorama below, which works off the path, is unaffected).
  return `${data.publicUrl}?v=${Date.now()}`;
}

// Not currently wired to any UI button — kept available for later (e.g.
// deleting a Camera Node could also clean up its panorama) so removing
// a node doesn't leave an orphaned object in the bucket forever.
// A panorama captured before §107 sits outside any business folder; it
// isn't found at this path, so its URL is cleared and the old file stays.
export async function deletePanorama(businessId: string, layoutId: string, cameraId: string): Promise<void> {
  const path = panoramaStoragePath(businessId, layoutId, cameraId);
  const { error } = await supabase.storage.from(PANORAMA_BUCKET).remove([path]);
  if (error) {
    throw new Error(`Failed to delete panorama: ${error.message}`);
  }
}
