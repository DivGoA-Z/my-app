// src/components/admin/BusinessImages.tsx
//
// One business's AI images (Make image, §132), for the super admin to
// review from the Usage page (§136): newest first, each with its customer
// and design. Click one to see it large.

import { useEffect, useState } from 'react';
import { Download, ExternalLink } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { fetchBusinessRenders, type AdminRender } from '../../lib/usageAdmin';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

const caption = (r: AdminRender) => [r.clientName ?? 'Customer removed', r.designName].filter(Boolean).join(' · ');

export function BusinessImages({ businessId, businessName }: { businessId: string; businessName: string }) {
  const [images, setImages] = useState<AdminRender[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<AdminRender | null>(null);

  useEffect(() => {
    let live = true;
    fetchBusinessRenders(businessId).then(
      (rows) => live && setImages(rows),
      (err: unknown) => live && setError(err instanceof Error ? err.message : 'Couldn’t load the images.')
    );
    return () => {
      live = false;
    };
  }, [businessId]);

  if (error) return <p className="text-[13px] text-destructive">{error}</p>;
  if (!images) return <p className="text-[13px] text-muted-foreground">Loading images…</p>;
  if (images.length === 0) return <p className="text-[13px] text-muted-foreground">No images made yet.</p>;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {images.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setOpen(r)}
            className="flex flex-col gap-1 overflow-hidden rounded-xl border border-border bg-card text-left hover:border-primary/60"
          >
            <img src={r.imageUrl} alt={`AI image for ${caption(r)}`} loading="lazy" className="aspect-video w-full object-cover" />
            <span className="truncate px-2 text-[13px] font-semibold">{caption(r)}</span>
            <span className="truncate px-2 pb-2 text-[12px] text-muted-foreground">
              {when(r.createdAt)} · {r.cameraLabel ?? 'View'}
              {r.styling ? ` · ${r.styling === 'styled' ? 'Styled' : 'Bare'}` : ''}
            </span>
          </button>
        ))}
      </div>
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
          {open && (
            <>
              <DialogHeader>
                <DialogTitle>{caption(open)}</DialogTitle>
                <DialogDescription>
                  {businessName} · {when(open.createdAt)} · {open.cameraLabel ?? 'View'}
                  {open.styling ? ` · ${open.styling === 'styled' ? 'Styled' : 'Bare'}` : ''}
                  {open.model ? ` · ${open.model}` : ''}
                </DialogDescription>
              </DialogHeader>
              <img src={open.imageUrl} alt={`AI image for ${caption(open)}`} className="w-full rounded-xl border border-border" />
              <div className="flex gap-2">
                <Button asChild variant="outline" size="sm">
                  <a href={open.imageUrl} download target="_blank" rel="noreferrer">
                    <Download /> Download
                  </a>
                </Button>
                <Button asChild variant="ghost" size="sm">
                  <a href={open.imageUrl} target="_blank" rel="noreferrer">
                    <ExternalLink /> Open in a new tab
                  </a>
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
