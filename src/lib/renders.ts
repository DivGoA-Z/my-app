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
import { withoutRefs, type RenderBrief } from './renderBrief';

export type RenderPart = { text: string } | { image: { mimeType: string; data: string } };

export interface RenderImageInput {
  // The file name the brief's referenceImages gives this picture.
  file: string;
  mimeType: 'image/png' | 'image/jpeg';
  // base64, no data: prefix.
  data: string;
}

export function renderParts(brief: RenderBrief, images: RenderImageInput[]): RenderPart[] {
  return [
    {
      text:
        'Make ONE photorealistic photograph of the kitchen described below. The JSON is the brief: follow its `prompt.instructions` and `prompt.imagePrompt` exactly. ' +
        'The pictures after it are the files listed in its `referenceImages`, each introduced by its file name.',
    },
    { text: JSON.stringify(withoutRefs(brief)) },
    ...images.flatMap((img): RenderPart[] => [{ text: `File "${img.file}":` }, { image: { mimeType: img.mimeType, data: img.data } }]),
    { text: 'Now make the one photograph from the main camera, as described. Return the image.' },
  ];
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
export async function snapshotBase64(url: string, mimeType: 'image/png' | 'image/jpeg'): Promise<string> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  // JPEG has no transparency: white, not black, behind anything clear.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
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
});

export async function saveRender(args: {
  businessId: string;
  layoutId: string;
  projectId: string | null;
  cameraLabel: string;
  styling: string;
  made: MadeRender;
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
