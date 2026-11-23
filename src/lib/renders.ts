// src/lib/renders.ts
//
// "Make image" (§132): the image brief, sent to Gemini through the Worker
// (worker/renderHandler.ts) instead of downloaded and uploaded by hand,
// and every image kept for review (table `design_renders`, bucket
// `renders`, under the business's own folder).
//
// What Gemini gets is what the hand-made route gave it (§128): the brief
// JSON (its `prompt.instructions` and `prompt.imagePrompt` say how to use
// everything), then each picture labelled with the file name the brief's
// `referenceImages` uses for it. Same files, same order, no new wording
// to drift from what was tested by hand.

import { supabase } from './Supabaseclient';
import { renderBriefFileStem, withoutRefs, type RenderBrief } from './renderBrief';

export type RenderPart = { text: string } | { image: { mimeType: string; data: string } };

// §139: said when a finish photo couldn't be fetched for Make image (the
// image is still made, from the finish's description), so a broken swatch
// link is noticed instead of quietly costing realism.
export function missingSwatchesMessage(names: string[]): string {
  return `Finish photo${names.length > 1 ? 's' : ''} couldn’t be loaded, so not sent: ${names.join(', ')}. The image uses ${names.length > 1 ? 'their descriptions' : 'its description'} instead. Check the photo in Catalogue → Finishes.`;
}

// The Worker refuses a request with more pictures than this (its
// MAX_IMAGES, Gemini Pro's limit). Kept in step by hand.
export const MAX_REQUEST_IMAGES = 14;

export interface RenderImageInput {
  // The file name the brief's referenceImages gives this picture.
  file: string;
  mimeType: 'image/png' | 'image/jpeg';
  // base64, no data: prefix.
  data: string;
}

// What a prompt is (§137): the words around the design. The design brief
// (JSON) and the camera pictures always come from the design; a prompt
// decides what's said before and after them, whether the brief is sent,
// and any reference photos sent with it.
export interface ImagePrompt {
  // null = the built-in prompt.
  id: string | null;
  name: string;
  intro: string;
  closing: string;
  includeBrief: boolean;
  // §141: whether the 3D colour preview is sent. Off tests whether it's
  // what pulls the image back to a render look, now that the real finish
  // photos are sent; the brief then never mentions it.
  sendColourPreview: boolean;
}

// The prompt Make image used from the start (§132), and still uses when no
// saved prompt is marked for businesses.
export const BUILT_IN_PROMPT: ImagePrompt = {
  id: null,
  name: 'Built-in',
  intro:
    'Make ONE photorealistic photograph of the kitchen described below. The JSON is the brief: follow its `prompt.instructions` and `prompt.imagePrompt` exactly. ' +
    'The pictures after it are the files listed in its `referenceImages`, each introduced by its file name.',
  closing: 'Now make the one photograph from the main camera, as described. Return the image.',
  includeBrief: true,
  sendColourPreview: true,
};

// A reference photo (§137): a real kitchen, for look and finish only.
export interface ReferencePhotoInput {
  mimeType: 'image/png' | 'image/jpeg';
  data: string;
}

// In order: the opening words, the brief, each camera picture under its
// file name, each reference photo, the closing words. Empty texts are left
// out (a prompt may have no closing).
export function renderParts(
  brief: RenderBrief,
  images: RenderImageInput[],
  prompt: ImagePrompt = BUILT_IN_PROMPT,
  references: ReferencePhotoInput[] = []
): RenderPart[] {
  const parts: RenderPart[] = [];
  if (prompt.intro.trim()) parts.push({ text: prompt.intro.trim() });
  if (prompt.includeBrief) parts.push({ text: JSON.stringify(withoutRefs(brief)) });
  for (const img of images) parts.push({ text: `File "${img.file}":` }, { image: { mimeType: img.mimeType, data: img.data } });
  references.forEach((ref, i) =>
    parts.push({ text: `Reference photo ${i + 1} (a real kitchen, for look and finish only):` }, { image: { mimeType: ref.mimeType, data: ref.data } })
  );
  if (prompt.closing.trim()) parts.push({ text: prompt.closing.trim() });
  return parts;
}

// The prompt as text, for "See prompt": every text part, with a line where
// each picture goes.
export function promptAsText(parts: RenderPart[]): string {
  return parts.map((p) => ('text' in p ? p.text : `[picture: ${p.image.mimeType}]`)).join('\n\n');
}

const ASPECTS: [string, number][] = [
  ['1:1', 1],
  ['4:3', 4 / 3],
  ['3:2', 3 / 2],
  ['16:9', 16 / 9],
  ['21:9', 21 / 9],
  ['3:4', 3 / 4],
  ['2:3', 2 / 3],
  ['9:16', 9 / 16],
];

// The nearest aspect ratio Gemini accepts.
export function nearestAspect(widthPx: number, heightPx: number): string {
  const r = widthPx / heightPx;
  return ASPECTS.reduce((best, a) => (Math.abs(a[1] - r) < Math.abs(best[1] - r) ? a : best))[0];
}

interface GeminiPart {
  text?: string;
  thought?: boolean;
  inlineData?: { mimeType?: string; data?: string };
  inline_data?: { mime_type?: string; data?: string };
}

// The image in Gemini's reply: the LAST non-"thought" image (the Pro model
// can return draft images while thinking). null + why, when there's none.
export function pickRenderImage(reply: unknown): { mimeType: string; data: string } | { error: string } {
  const r = reply as { candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } };
  const cand = r?.candidates?.[0];
  const parts = cand?.content?.parts ?? [];
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (p.thought) continue;
    const data = p.inlineData?.data ?? p.inline_data?.data;
    if (data) return { mimeType: p.inlineData?.mimeType ?? p.inline_data?.mime_type ?? 'image/png', data };
  }
  const said = parts.map((p) => p.text).filter(Boolean).join(' ').trim();
  const why = r?.promptFeedback?.blockReason ?? cand?.finishReason;
  return { error: `No image came back${why ? ` (${why})` : ''}.${said ? ` The model said: “${said.slice(0, 200)}”` : ''}` };
}

export interface MadeRender {
  mimeType: string;
  data: string;
  model: string;
}

export async function makeRender(parts: RenderPart[], aspectRatio: string): Promise<MadeRender> {
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  const res = await fetch('/api/render', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ parts, aspectRatio }),
  });
  if (!res.ok) {
    const message = await res
      .json()
      .then((b: { error?: string }) => b.error)
      .catch(() => undefined);
    throw new Error(message ?? `The image service isn’t available right now (${res.status}).`);
  }
  const picked = pickRenderImage(await res.json());
  if ('error' in picked) throw new Error(picked.error);
  return { ...picked, model: res.headers.get('x-render-model') ?? '' };
}

export function base64ToBlob(data: string, mimeType: string): Blob {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

// A snapshot (data: or blob: URL) as base64: JPEG for colour views (a
// tenth of the PNG's size, and the Worker's request stays small), PNG for
// line drawings (crisp edges, and mostly white, so small anyway).
// `maxPx` shrinks a big picture (a finish photo, §139) to fit, so six of
// them stay a small part of the request.
export async function snapshotBase64(url: string, mimeType: 'image/png' | 'image/jpeg', maxPx?: number): Promise<string> {
  const img = new Image();
  // For a reference photo on Supabase storage (§137): without it the canvas
  // is "tainted" and can't be read back. Harmless for data:/blob: URLs.
  img.crossOrigin = 'anonymous';
  img.src = url;
  await img.decode();
  const canvas = document.createElement('canvas');
  const scale = maxPx ? Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight)) : 1;
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext('2d')!;
  // JPEG has no transparency: white, not black, behind anything clear.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(mimeType, 0.88).split(',')[1];
}

// ---- Kept for review ----

export interface DesignRender {
  id: string;
  layoutId: string;
  cameraLabel: string | null;
  styling: string | null;
  model: string | null;
  imageUrl: string;
  imagePath: string;
  createdAt: string;
  // Which prompt made it (§137); null on images made before prompts.
  promptName: string | null;
}

// The name a downloaded image is saved under. Storage keeps each under a
// random id, so every download used to look the same; this says which
// design, camera, prompt and styling made it, and when (local time, to the
// minute), so images saved side by side can be told apart and compared.
export function renderFileName(designName: string, r: Pick<DesignRender, 'cameraLabel' | 'promptName' | 'styling' | 'createdAt' | 'imagePath'>): string {
  const d = new Date(r.createdAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  const ext = r.imagePath.match(/\.(\w+)$/)?.[1] ?? 'png';
  const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const words = [renderBriefFileStem(designName), slug(r.cameraLabel ?? 'view'), slug(r.promptName ?? 'built-in'), slug(r.styling ?? '')];
  return `${words.filter(Boolean).join('-')}-${stamp}.${ext}`;
}

// Saves the image under renderFileName. A plain <a download> can't name a
// file from another origin (Supabase storage): the browser ignores the
// name, so it's fetched and saved from a local blob instead. If that
// fails, the image opens in a new tab as before.
export async function downloadRender(url: string, fileName: string): Promise<void> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const href = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = href;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}

const RENDER_BUCKET = 'renders';

interface DesignRenderRow {
  id: string;
  layout_id: string;
  camera_label: string | null;
  styling: string | null;
  model: string | null;
  image_url: string;
  image_path: string;
  created_at: string;
  prompt_name?: string | null;
}

const fromRow = (r: DesignRenderRow): DesignRender => ({
  id: r.id,
  layoutId: r.layout_id,
  cameraLabel: r.camera_label,
  styling: r.styling,
  model: r.model,
  imageUrl: r.image_url,
  imagePath: r.image_path,
  createdAt: r.created_at,
  promptName: r.prompt_name ?? null,
});

export async function saveRender(args: {
  businessId: string;
  layoutId: string;
  projectId: string | null;
  cameraLabel: string;
  styling: string;
  made: MadeRender;
  prompt: ImagePrompt;
}): Promise<DesignRender> {
  const id = crypto.randomUUID();
  const ext = args.made.mimeType === 'image/jpeg' ? 'jpg' : 'png';
  // Under the business's own folder (§107): storage only lets a member write there.
  const path = `${args.businessId}/${args.layoutId}/${id}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from(RENDER_BUCKET)
    .upload(path, base64ToBlob(args.made.data, args.made.mimeType), { contentType: args.made.mimeType, upsert: false });
  if (upErr) throw new Error(`Couldn’t save the image: ${upErr.message}`);
  const url = supabase.storage.from(RENDER_BUCKET).getPublicUrl(path).data.publicUrl;
  const { data, error } = await supabase
    .from('design_renders')
    .insert({
      id,
      business_id: args.businessId,
      project_id: args.projectId,
      layout_id: args.layoutId,
      camera_label: args.cameraLabel,
      styling: args.styling,
      model: args.made.model,
      image_path: path,
      image_url: url,
      prompt_id: args.prompt.id,
      prompt_name: args.prompt.name,
    })
    .select('*')
    .single();
  if (error) throw new Error(`Couldn’t save the image: ${error.message}`);
  return fromRow(data as DesignRenderRow);
}

export async function listRenders(layoutId: string): Promise<DesignRender[]> {
  const { data, error } = await supabase
    .from('design_renders')
    .select('*')
    .eq('layout_id', layoutId)
    .order('created_at', { ascending: false })
    .limit(60);
  if (error) throw new Error(`Couldn’t load the saved images: ${error.message}`);
  return (data as DesignRenderRow[]).map(fromRow);
}

export async function deleteRender(r: DesignRender): Promise<void> {
  const { error } = await supabase.from('design_renders').delete().eq('id', r.id);
  if (error) throw new Error(`Couldn’t delete the image: ${error.message}`);
  await supabase.storage.from(RENDER_BUCKET).remove([r.imagePath]);
}
