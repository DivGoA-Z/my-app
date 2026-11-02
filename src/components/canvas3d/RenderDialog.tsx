// src/components/canvas3d/RenderDialog.tsx
//
// "Make image" (§132): the image as it's made, then every image made for
// this design, newest first, kept for review (lib/renders.ts). For the
// super admin, Compare (§137): any two side by side, with the prompt that
// made each, to judge prompts against each other on the same design.

import { useEffect, useState } from 'react';
import { Columns2, Download, Loader2, Trash2 } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { deleteRender, listRenders, type DesignRender } from '../../lib/renders';

export type RenderJob = { state: 'working'; cameraLabel: string } | { state: 'done'; render: DesignRender } | { state: 'error'; message: string };

// "Camera 1 · Styled · Prompt: Strict"
function details(r: DesignRender): string {
  return [r.cameraLabel ?? 'View', r.styling ? (r.styling === 'styled' ? 'Styled' : 'Bare') : null, `Prompt: ${r.promptName ?? 'Built-in'}`]
    .filter(Boolean)
    .join(' · ');
}

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

// Elapsed seconds while waiting, so a long wait doesn't look stuck.
function Elapsed() {
  const [s, setS] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setS((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="tabular-nums">{s}s</span>;
}

export function RenderDialog({
  open,
  onOpenChange,
  layoutId,
  job,
  designName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  layoutId: string | null;
  job: RenderJob | null;
  designName: string;
}) {
  const [saved, setSaved] = useState<DesignRender[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<DesignRender | null>(null);
  const isSuperAdmin = useAuthStore((s) => s.isSuperAdmin);
  // Compare (§137): the two picked, in the order picked.
  const [comparing, setComparing] = useState(false);
  const [pair, setPair] = useState<DesignRender[]>([]);
  const pick = (r: DesignRender) =>
    setPair((prev) => (prev.some((x) => x.id === r.id) ? prev.filter((x) => x.id !== r.id) : [...prev, r].slice(-2)));
  const latestId = job?.state === 'done' ? job.render.id : null;

  // The saved images, whenever the dialog opens or a new one is saved.
  useEffect(() => {
    if (!open || !layoutId) return;
    let live = true;
    listRenders(layoutId).then(
      (rows) => live && (setSaved(rows), setLoadError(null)),
      (err: unknown) => live && setLoadError(err instanceof Error ? err.message : 'Couldn’t load the saved images.')
    );
    return () => {
      live = false;
    };
  }, [open, layoutId, latestId]);

  const shown = viewing ?? (job?.state === 'done' ? job.render : null);

  async function remove(r: DesignRender) {
    try {
      await deleteRender(r);
      setSaved((prev) => prev?.filter((x) => x.id !== r.id) ?? null);
      if (viewing?.id === r.id) setViewing(null);
      toast.success('Image deleted.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Couldn’t delete the image.');
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setViewing(null);
          setComparing(false);
          setPair([]);
        }
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Images</DialogTitle>
          <DialogDescription>Made by AI from this design. Every image is saved here for later.</DialogDescription>
        </DialogHeader>

        {comparing && (
          <div className="flex flex-col gap-2">
            <p className="text-[13px] text-muted-foreground">
              {pair.length < 2 ? `Pick ${2 - pair.length} ${pair.length ? 'more image' : 'images'} below to compare.` : 'Pick another to swap out the older choice.'}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {[0, 1].map((i) =>
                pair[i] ? (
                  <figure key={pair[i].id} className="flex flex-col gap-1.5">
                    <img src={pair[i].imageUrl} alt={`Compared image ${i + 1}`} className="w-full rounded-xl border border-border" />
                    <figcaption className="text-[13px]">
                      <span className="font-semibold">{pair[i].promptName ?? 'Built-in'}</span>
                      <span className="text-muted-foreground"> · {when(pair[i].createdAt)} · {details(pair[i]).replace(/ · Prompt: .*$/, '')}{pair[i].model ? ` · ${pair[i].model}` : ''}</span>
                    </figcaption>
                  </figure>
                ) : (
                  <div key={i} className="flex aspect-video items-center justify-center rounded-xl border border-dashed border-border text-[13px] text-muted-foreground">
                    Image {i + 1}
                  </div>
                )
              )}
            </div>
          </div>
        )}
        {!comparing && job?.state === 'working' && !viewing && (
          <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-xl bg-secondary text-[14px] text-muted-foreground">
            <Loader2 className="size-7 animate-spin text-primary" />
            <span>
              Making the image from {job.cameraLabel}… <Elapsed />
            </span>
            <span className="text-[12px]">Usually 20–60 seconds. You can close this; it keeps going and saves here.</span>
          </div>
        )}
        {!comparing && job?.state === 'error' && !viewing && (
          <p role="alert" className="rounded-xl bg-destructive/10 px-3.5 py-3 text-[14px] text-destructive">
            {job.message}
          </p>
        )}
        {!comparing && shown && (
          <figure className="flex flex-col gap-2">
            <img src={shown.imageUrl} alt={`AI image of ${designName}`} className="w-full rounded-xl border border-border" />
            <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-muted-foreground">
              <span>
                {when(shown.createdAt)} · {details(shown)}
              </span>
              <span className="flex-1" />
              <Button asChild variant="outline" size="sm">
                <a href={shown.imageUrl} download target="_blank" rel="noreferrer">
                  <Download /> Download
                </a>
              </Button>
              <Button variant="ghost" size="sm" onClick={() => remove(shown)} aria-label="Delete this image">
                <Trash2 /> Delete
              </Button>
            </figcaption>
          </figure>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="flex-1 text-[13px] font-semibold">Saved for this design{saved ? ` (${saved.length})` : ''}</span>
            {isSuperAdmin && saved && saved.length >= 2 && (
              <Button
                variant={comparing ? 'secondary' : 'outline'}
                size="sm"
                aria-pressed={comparing}
                onClick={() => {
                  setComparing((c) => !c);
                  setPair([]);
                }}
              >
                <Columns2 /> {comparing ? 'Done comparing' : 'Compare'}
              </Button>
            )}
          </div>
          {loadError && <p className="text-[13px] text-destructive">{loadError}</p>}
          {saved && saved.length === 0 && !loadError && <p className="text-[13px] text-muted-foreground">None yet.</p>}
          {saved && saved.length > 0 && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {saved.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => (comparing ? pick(r) : setViewing(r))}
                  aria-pressed={comparing ? pair.some((x) => x.id === r.id) : undefined}
                  className={`overflow-hidden rounded-lg border-2 ${
                    (comparing ? pair.some((x) => x.id === r.id) : shown?.id === r.id) ? 'border-primary' : 'border-transparent'
                  }`}
                  title={`${when(r.createdAt)} · ${details(r)}`}
                >
                  <img src={r.imageUrl} alt="" loading="lazy" className="aspect-video w-full object-cover" />
                  {isSuperAdmin && <span className="block truncate bg-card px-1 py-0.5 text-left text-[11px]">{r.promptName ?? 'Built-in'}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
