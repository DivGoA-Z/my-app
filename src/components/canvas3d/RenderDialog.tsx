// src/components/canvas3d/RenderDialog.tsx
//
// "Make image" (§132): the image as it's made, then every image made for
// this design, newest first, kept for review (lib/renders.ts).

import { useEffect, useState } from 'react';
import { Download, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { deleteRender, listRenders, type DesignRender } from '../../lib/renders';

export type RenderJob = { state: 'working'; cameraLabel: string } | { state: 'done'; render: DesignRender } | { state: 'error'; message: string };

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
        if (!o) setViewing(null);
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Images</DialogTitle>
          <DialogDescription>Made by AI from this design. Every image is saved here for later.</DialogDescription>
        </DialogHeader>

        {job?.state === 'working' && !viewing && (
          <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-xl bg-secondary text-[14px] text-muted-foreground">
            <Loader2 className="size-7 animate-spin text-primary" />
            <span>
              Making the image from {job.cameraLabel}… <Elapsed />
            </span>
            <span className="text-[12px]">Usually 20–60 seconds. You can close this; it keeps going and saves here.</span>
          </div>
        )}
        {job?.state === 'error' && !viewing && (
          <p role="alert" className="rounded-xl bg-destructive/10 px-3.5 py-3 text-[14px] text-destructive">
            {job.message}
          </p>
        )}
        {shown && (
          <figure className="flex flex-col gap-2">
            <img src={shown.imageUrl} alt={`AI image of ${designName}`} className="w-full rounded-xl border border-border" />
            <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-muted-foreground">
              <span>
                {when(shown.createdAt)} · {shown.cameraLabel ?? 'View'}
                {shown.styling ? ` · ${shown.styling === 'styled' ? 'Styled' : 'Bare'}` : ''}
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
          <span className="text-[13px] font-semibold">Saved for this design{saved ? ` (${saved.length})` : ''}</span>
          {loadError && <p className="text-[13px] text-destructive">{loadError}</p>}
          {saved && saved.length === 0 && !loadError && <p className="text-[13px] text-muted-foreground">None yet.</p>}
          {saved && saved.length > 0 && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {saved.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setViewing(r)}
                  className={`overflow-hidden rounded-lg border-2 ${shown?.id === r.id ? 'border-primary' : 'border-transparent'}`}
                  title={`${when(r.createdAt)} · ${r.cameraLabel ?? ''}`}
                >
                  <img src={r.imageUrl} alt="" loading="lazy" className="aspect-video w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
