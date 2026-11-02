// src/lib/renderPrompts.ts
//
// The software owner's prompt lab (§137): up to five named prompts for
// Make image, one of which can be the PRODUCTION prompt every business
// uses (none = the built-in prompt, BUILT_IN_PROMPT in renders.ts). Each
// may carry up to three reference photos of real kitchens, sent with
// every image made with it. The database enforces who may do what
// (render_prompts' policies); this file only reads and writes.

import { supabase } from './Supabaseclient';
import { BUILT_IN_PROMPT, snapshotBase64, type ImagePrompt, type ReferencePhotoInput } from './renders';

export const MAX_PROMPTS = 5;
export const MAX_REFERENCE_PHOTOS = 3;
const REFS_BUCKET = 'prompt-refs';

export interface ReferencePhoto {
  url: string;
  path: string;
  label: string;
}

export interface SavedPrompt extends ImagePrompt {
  id: string;
  referenceImages: ReferencePhoto[];
  isProduction: boolean;
  updatedAt: string;
}

interface PromptRow {
  id: string;
  name: string;
  intro: string;
  closing: string;
  include_brief: boolean;
  reference_images: ReferencePhoto[] | null;
  is_production: boolean;
  updated_at: string;
}

const fromRow = (r: PromptRow): SavedPrompt => ({
  id: r.id,
  name: r.name,
  intro: r.intro,
  closing: r.closing,
  includeBrief: r.include_brief,
  referenceImages: r.reference_images ?? [],
  isProduction: r.is_production,
  updatedAt: r.updated_at,
});

const notSetUp = (message: string) => /render_prompts|relation .* does not exist|PGRST205/i.test(message);

// Every saved prompt (the super admin sees all; anyone else, at most the
// production one).
export async function listPrompts(): Promise<SavedPrompt[]> {
  const { data, error } = await supabase.from('render_prompts').select('*').order('created_at');
  if (error) throw new Error(notSetUp(error.message) ? 'Prompts aren’t set up yet: re-run supabase/schema.sql.' : `Couldn’t load the prompts: ${error.message}`);
  return (data as PromptRow[]).map(fromRow);
}

// The prompt businesses use: the one marked production, else built-in.
// A failure to read falls back to built-in rather than stopping Make image.
export async function productionPrompt(): Promise<SavedPrompt | typeof BUILT_IN_PROMPT> {
  const { data, error } = await supabase.from('render_prompts').select('*').eq('is_production', true).maybeSingle();
  if (error || !data) return BUILT_IN_PROMPT;
  return fromRow(data as PromptRow);
}

export async function createPrompt(from: ImagePrompt, name: string): Promise<SavedPrompt> {
  const { data, error } = await supabase
    .from('render_prompts')
    .insert({ id: crypto.randomUUID(), name: name.trim(), intro: from.intro, closing: from.closing, include_brief: from.includeBrief })
    .select('*')
    .single();
  if (error) throw new Error(error.message.includes('At most 5') ? `At most ${MAX_PROMPTS} prompts: delete one first.` : `Couldn’t save: ${error.message}`);
  return fromRow(data as PromptRow);
}

export async function savePrompt(p: Pick<SavedPrompt, 'id' | 'name' | 'intro' | 'closing' | 'includeBrief'>): Promise<SavedPrompt> {
  const { data, error } = await supabase
    .from('render_prompts')
    .update({ name: p.name.trim(), intro: p.intro, closing: p.closing, include_brief: p.includeBrief, updated_at: new Date().toISOString() })
    .eq('id', p.id)
    .select('*')
    .single();
  if (error) throw new Error(`Couldn’t save: ${error.message}`);
  return fromRow(data as PromptRow);
}

export async function deletePrompt(p: SavedPrompt): Promise<void> {
  const { error } = await supabase.from('render_prompts').delete().eq('id', p.id);
  if (error) throw new Error(`Couldn’t delete: ${error.message}`);
  if (p.referenceImages.length) await supabase.storage.from(REFS_BUCKET).remove(p.referenceImages.map((r) => r.path));
}

// null = the built-in prompt for businesses.
export async function setProductionPrompt(id: string | null): Promise<void> {
  const { error } = await supabase.rpc('admin_set_production_prompt', { p_id: id });
  if (error) throw new Error(`Couldn’t change the production prompt: ${error.message}`);
}

async function setReferences(id: string, refs: ReferencePhoto[]): Promise<SavedPrompt> {
  const { data, error } = await supabase
    .from('render_prompts')
    .update({ reference_images: refs, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(`Couldn’t save the photos: ${error.message}`);
  return fromRow(data as PromptRow);
}

// A reference photo, resized to at most 1280 px wide as JPEG: plenty for
// look and finish, and it keeps every Make image request small.
export async function addReferencePhoto(p: SavedPrompt, file: File): Promise<SavedPrompt> {
  if (p.referenceImages.length >= MAX_REFERENCE_PHOTOS) throw new Error(`At most ${MAX_REFERENCE_PHOTOS} reference photos per prompt.`);
  if (!file.type.startsWith('image/')) throw new Error('That isn’t an image.');
  const blob = await shrinkToJpeg(file, 1280);
  const path = `prompts/${p.id}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from(REFS_BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw new Error(`Couldn’t upload the photo: ${error.message}`);
  const url = supabase.storage.from(REFS_BUCKET).getPublicUrl(path).data.publicUrl;
  return setReferences(p.id, [...p.referenceImages, { url, path, label: file.name }]);
}

export async function removeReferencePhoto(p: SavedPrompt, ref: ReferencePhoto): Promise<SavedPrompt> {
  const next = await setReferences(
    p.id,
    p.referenceImages.filter((r) => r.path !== ref.path)
  );
  await supabase.storage.from(REFS_BUCKET).remove([ref.path]);
  return next;
}

async function shrinkToJpeg(file: File, maxWidth: number): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, maxWidth / img.naturalWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Couldn’t read the image.'))), 'image/jpeg', 0.88));
  } finally {
    URL.revokeObjectURL(url);
  }
}

// A prompt's reference photos as picture parts, for Make image.
export async function referencePhotoParts(p: ImagePrompt): Promise<ReferencePhotoInput[]> {
  const refs = 'referenceImages' in p ? (p as SavedPrompt).referenceImages : [];
  return Promise.all(refs.map(async (r) => ({ mimeType: 'image/jpeg' as const, data: await snapshotBase64(r.url, 'image/jpeg') })));
}
