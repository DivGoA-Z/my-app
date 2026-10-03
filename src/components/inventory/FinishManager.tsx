// src/components/inventory/FinishManager.tsx
//
// Manages the business's finish catalogue (types/finish.ts) — the real
// products they stock, e.g. "Merino Walnut 4102, gloss laminate".
//
// WHY THIS ISN'T A TABLE like the other InventoryManager sections: a
// finish carries ~13 fields (identity, pattern, appearance, relief,
// four optical values, physical swatch size, tiling, price). Squeezing
// that into one row per finish would be unreadable and unusable on a
// laptop. So it's a card grid you can scan visually — which matters
// more here than anywhere else in the app, since the whole point of a
// finish is what it LOOKS like — with one card expanding into a full
// editor at a time.
//
// Uploads: a photographed swatch supplies colour only. Relief is
// derived from its luminance (see deriveNormalMap in lib/textures3d.ts)
// and gloss comes from the optical values below, because a photo can
// tell you neither. That's why those controls stay visible even for an
// uploaded finish rather than being hidden as "advanced".

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { EditPanel } from '../common/EditPanel';
import { NewButton } from './CatalogueKit';
import { finishSwatch } from '../../lib/designFinishes';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { confirmDialog } from '../../store/confirmDialogStore';
import { useLayoutStore } from '../../store/layoutStore';
import type { SurfaceFinish, PatternCategory, TilingMode } from '../../types/finish';
import {
  PATTERN_CATEGORY_LABELS,
  PATTERN_RELIEF_PRESET,
  COMMON_FINISH_TYPE_LABELS,
  FINISH_TYPE_OPTICAL_PRESET,
  FALLBACK_OPTICAL_PRESET,
} from '../../types/finish';

const PATTERN_CATEGORIES = Object.keys(PATTERN_CATEGORY_LABELS) as PatternCategory[];
const TILING_MODES: TilingMode[] = ['mirror', 'repeat'];

function blankFinish(): SurfaceFinish {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    label: '',
    finishTypeLabel: 'Laminate',
    patternCategory: 'solid',
    solidColor: '#e8e4dc',
    reliefStrength: PATTERN_RELIEF_PRESET.solid,
    ...FINISH_TYPE_OPTICAL_PRESET.Laminate,
    swatchWidthMm: 300,
    swatchHeightMm: 300,
    tilingMode: 'mirror',
    pricePerSqM: 0,
    source: 'uploaded',
    createdAt: now,
    updatedAt: now,
  };
}

const inputClass = 'h-11 w-full rounded-[10px] border border-input bg-card px-3 text-[15px]';
const labelClass = 'flex flex-col gap-1.5 text-[13px] font-semibold text-foreground';

export function FinishManager() {
  const finishes = useLayoutStore((s) => s.finishes);
  const upsertFinish = useLayoutStore((s) => s.upsertFinish);
  const removeFinish = useLayoutStore((s) => s.removeFinish);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SurfaceFinish | null>(null);
  const [error, setError] = useState<string | null>(null);

  function startEdit(finish: SurfaceFinish) {
    setDraft({ ...finish });
    setEditingId(finish.id);
    setError(null);
  }

  function startNew() {
    const fresh = blankFinish();
    setDraft(fresh);
    setEditingId(fresh.id);
    setError(null);
  }

  function cancel() {
    setDraft(null);
    setEditingId(null);
    setError(null);
  }

  async function handleSave() {
    if (!draft) return;
    if (!draft.label.trim()) {
      setError('Give the finish a name.');
      return;
    }
    try {
      await upsertFinish({ ...draft, updatedAt: new Date().toISOString() });
      cancel();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save finish.');
    }
  }

  async function handleDelete(finish: SurfaceFinish) {
    if (!(await confirmDialog({ title: `Delete "${finish.label}"?`, description: "This can't be undone." })))
      return;
    setError(null);
    try {
      await removeFinish(finish.id);
      if (editingId === finish.id) cancel();
      toast.success(`Deleted "${finish.label}"`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete finish.';
      setError(message);
      toast.error('Failed to delete', { description: message });
    }
  }

  return (
    <section className="flex flex-col gap-3">
      {/* Title and description come from the Catalogue page's section
          frame (CatalogueSection, §71). */}
      <div className="flex justify-end">
        <NewButton label="New finish" onClick={startNew} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {finishes.map((finish) => (
          <FinishCard
            key={finish.id}
            finish={finish}
            isEditing={editingId === finish.id}
            onEdit={() => startEdit(finish)}
          />
        ))}
        {finishes.length === 0 && (
          <p className="col-span-full text-xs text-muted-foreground">
            No finishes yet — add one, or run supabase/schema.sql to seed the defaults.
          </p>
        )}
      </div>

      <EditPanel
        open={!!draft}
        onOpenChange={(o) => !o && cancel()}
        title={draft && finishes.some((f) => f.id === draft.id) ? draft.label || 'Finish' : 'New finish'}
        onSave={handleSave}
        saveLabel={draft && finishes.some((f) => f.id === draft.id) ? 'Save' : 'Add finish'}
        error={error}
        onDelete={draft && finishes.some((f) => f.id === draft.id) ? () => handleDelete(draft) : undefined}
      >
        {draft && (
          <FinishEditor draft={draft} setDraft={setDraft} />
        )}
      </EditPanel>
    </section>
  );
}

// Visual swatch — the whole reason this section isn't a table. Shows
// the uploaded image where there is one, the solid colour otherwise,
// and a hatched placeholder for a procedural finish (whose real look is
// generated at render time and can't be previewed as a flat image here).
function SwatchPreview({ finish, className = '' }: { finish: SurfaceFinish; className?: string }) {
  if (finish.albedoUrl) {
    return (
      <img
        src={finish.albedoUrl}
        alt={finish.label}
        className={`h-full w-full object-cover ${className}`}
      />
    );
  }
  // A generated finish now shows its texture's colour map (the same
  // files the 3D view uses) instead of a yellow "wood" placeholder (§76).
  const sw = finishSwatch(finish);
  if (sw?.image) {
    return <img src={sw.image} alt={finish.label} className={`h-full w-full object-cover ${className}`} />;
  }
  return (
    <div
      className={`h-full w-full ${className}`}
      style={{ backgroundColor: finish.solidColor ?? '#dcd7cf' }}
    />
  );
}

interface FinishCardProps {
  finish: SurfaceFinish;
  isEditing: boolean;
  onEdit: () => void;
}

function FinishCard({ finish, isEditing, onEdit }: FinishCardProps) {
  return (
    <button
      type="button"
      onClick={onEdit}
      className={`flex flex-col overflow-hidden rounded-2xl bg-card text-left shadow-card transition-shadow hover:shadow-float ${
        isEditing ? 'ring-2 ring-primary' : ''
      }`}
    >
      <div className="h-24 w-full border-b border-border">
        <SwatchPreview finish={finish} />
      </div>
      <div className="flex min-w-0 flex-col gap-0.5 px-3.5 py-3">
        <span className="truncate text-[15px] font-semibold">
          {finish.brand ? `${finish.brand} ${finish.label}` : finish.label}
        </span>
        <span className="truncate text-[13px] text-muted-foreground">
          {finish.finishTypeLabel} · {PATTERN_CATEGORY_LABELS[finish.patternCategory]}
        </span>
        <span className="pt-1 text-sm font-bold">
          ₹{finish.pricePerSqM.toLocaleString('en-IN')}
          <span className="font-normal text-muted-foreground"> / m²</span>
        </span>
      </div>
    </button>
  );
}

interface FinishEditorProps {
  draft: SurfaceFinish;
  setDraft: (finish: SurfaceFinish) => void;
}

function FinishEditor({ draft, setDraft }: FinishEditorProps) {
  const uploadFinishSwatch = useLayoutStore((s) => s.uploadFinishSwatch);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const patch = (updates: Partial<SurfaceFinish>) => setDraft({ ...draft, ...updates });

  // Changing the pattern category re-seeds relief, because the right
  // depth for wood is badly wrong for polished stone — see
  // PATTERN_RELIEF_PRESET. The slider below still overrides it.
  function handleCategoryChange(patternCategory: PatternCategory) {
    patch({ patternCategory, reliefStrength: PATTERN_RELIEF_PRESET[patternCategory] });
  }

  // Changing the finish type re-seeds the optical values, so picking
  // "Acrylic" gives gloss defaults without the user needing to know
  // what clearcoat means.
  function handleTypeChange(finishTypeLabel: string) {
    const preset = FINISH_TYPE_OPTICAL_PRESET[finishTypeLabel] ?? FALLBACK_OPTICAL_PRESET;
    patch({ finishTypeLabel, ...preset });
  }

  async function handleUpload(file: File) {
    setIsUploading(true);
    setUploadError(null);
    try {
      const albedoUrl = await uploadFinishSwatch(draft.id, file);
      // An uploaded photo takes over from any solid colour — a finish is
      // one or the other, never both (types/finish.ts).
      patch({ albedoUrl, solidColor: undefined, proceduralKind: undefined, source: 'uploaded' });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setIsUploading(false);
    }
  }

  // Title, Save and Cancel come from the EditPanel around it (§76).
  return (
    <div className="flex flex-col gap-4">

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Name
          <input
            value={draft.label}
            onChange={(e) => patch({ label: e.target.value })}
            placeholder="Walnut 4102"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Brand
          <input
            value={draft.brand ?? ''}
            onChange={(e) => patch({ brand: e.target.value || undefined })}
            placeholder="Merino"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Code
          <input
            value={draft.code ?? ''}
            onChange={(e) => patch({ code: e.target.value || undefined })}
            placeholder="4102"
            className={inputClass}
          />
        </label>

        <label className={labelClass}>
          Finish type
          <input
            list="finish-type-suggestions"
            value={draft.finishTypeLabel}
            onChange={(e) => handleTypeChange(e.target.value)}
            className={inputClass}
          />
          <datalist id="finish-type-suggestions">
            {COMMON_FINISH_TYPE_LABELS.map((label) => (
              <option key={label} value={label} />
            ))}
          </datalist>
        </label>

        <div className={labelClass}>
          Pattern
          <Select value={draft.patternCategory} onValueChange={(value) => handleCategoryChange(value as PatternCategory)}>
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PATTERN_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {PATTERN_CATEGORY_LABELS[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <label className={labelClass}>
          Price (₹ per m²)
          <input
            type="number"
            min={0}
            step={50}
            value={draft.pricePerSqM}
            onChange={(e) => patch({ pricePerSqM: Number(e.target.value) })}
            className={inputClass}
          />
        </label>
      </div>

      {/* Appearance: image or colour, never both */}
      <div className="flex gap-3 border-t border-border pt-3">
        <div className="h-24 w-24 shrink-0 overflow-hidden rounded border border-input">
          <SwatchPreview finish={draft} />
        </div>

        <div className="flex flex-1 flex-col gap-2">
          <label className={labelClass}>
            Swatch photo
            <input
              type="file"
              accept="image/*"
              disabled={isUploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUpload(file);
              }}
              className="text-[13px]"
            />
          </label>
          {isUploading && <span className="text-xs text-muted-foreground">Uploading…</span>}
          {uploadError && <span className="text-xs text-destructive">{uploadError}</span>}

          {draft.albedoUrl ? (
            <Button
              variant="link"
              size="xs"
              className="h-auto self-start p-0 text-xs"
              onClick={() =>
                patch({ albedoUrl: undefined, solidColor: draft.solidColor ?? '#e8e4dc' })
              }
            >
              Remove photo, use a solid colour instead
            </Button>
          ) : (
            <label className={labelClass}>
              Solid colour
              <input
                type="color"
                value={draft.solidColor ?? '#e8e4dc'}
                onChange={(e) => patch({ solidColor: e.target.value })}
                className="h-7 w-16 cursor-pointer rounded border border-input"
              />
            </label>
          )}
        </div>
      </div>

      {/* Real PBR maps. Text paths rather than uploads because these
          normally arrive as a downloaded CC0 set dropped into
          public/textures/ — and a normal map is meaningless without the
          albedo it was authored against, so they're only offered once
          there's an image. */}
      {draft.albedoUrl && (
        <div className="grid grid-cols-1 gap-3 border-t border-border pt-4 sm:grid-cols-2">
          <label className={labelClass}>
            Normal map URL
            <input
              value={draft.normalMapUrl ?? ''}
              onChange={(e) => patch({ normalMapUrl: e.target.value || undefined })}
              placeholder="/textures/wood/normal.jpg"
              className={inputClass}
            />
            <span className="text-xs text-muted-foreground">
              Overrides the relief guessed from the photo's light and shade. Use NormalGL (OpenGL)
              maps — a DirectX one inverts the bumps.
            </span>
          </label>
          <label className={labelClass}>
            Roughness map URL
            <input
              value={draft.roughnessMapUrl ?? ''}
              onChange={(e) => patch({ roughnessMapUrl: e.target.value || undefined })}
              placeholder="/textures/wood/roughness.jpg"
              className={inputClass}
            />
            <span className="text-xs text-muted-foreground">
              Lets sheen vary across the surface — glossy tile against matte grout, which the
              single roughness slider below can't express.
            </span>
          </label>
        </div>
      )}

      {/* Physical scale + tiling — only meaningful for an image */}
      {draft.albedoUrl && (
        <div className="grid grid-cols-1 gap-3 border-t border-border pt-4 sm:grid-cols-2">
          <label className={labelClass}>
            Swatch width (mm)
            <input
              type="number"
              min={10}
              value={draft.swatchWidthMm}
              onChange={(e) => patch({ swatchWidthMm: Number(e.target.value) })}
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            Swatch height (mm)
            <input
              type="number"
              min={10}
              value={draft.swatchHeightMm}
              onChange={(e) => patch({ swatchHeightMm: Number(e.target.value) })}
              className={inputClass}
            />
          </label>
          <div className={labelClass}>
            Tiling
            <Select value={draft.tilingMode} onValueChange={(value) => patch({ tilingMode: value as TilingMode })}>
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TILING_MODES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m === 'mirror' ? 'Mirror (hides seams)' : 'Repeat'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="col-span-3 text-xs text-muted-foreground">
            Swatch size is the real area the photo covers — get this wrong and the pattern renders
            at the wrong scale. Mirror tiling flips alternate copies so photographed edges match;
            it costs a little symmetry but removes hard seams.
          </p>
        </div>
      )}

      {/* Relief + optical response */}
      <div className="grid grid-cols-1 gap-3 border-t border-border pt-4 sm:grid-cols-2">
        <label className={labelClass}>
          Relief depth ({draft.reliefStrength.toFixed(2)})
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={draft.reliefStrength}
            onChange={(e) => patch({ reliefStrength: Number(e.target.value) })}
          />
          <span className="text-xs text-muted-foreground">
            Derived from the photo's light and shade. Good for wood and fabric; keep near 0 for
            polished stone, where dark veins are flush, not recessed.
          </span>
        </label>

        <label className={labelClass}>
          Roughness ({draft.roughness.toFixed(2)})
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={draft.roughness}
            onChange={(e) => patch({ roughness: Number(e.target.value) })}
          />
          <span className="text-xs text-muted-foreground">0 = mirror, 1 = fully matte.</span>
        </label>

        <label className={labelClass}>
          Clearcoat ({draft.clearcoat.toFixed(2)})
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={draft.clearcoat}
            onChange={(e) => patch({ clearcoat: Number(e.target.value) })}
          />
          <span className="text-xs text-muted-foreground">
            The lacquer layer that gives acrylic and PU their depth. 0 for matte laminates.
          </span>
        </label>

        <label className={labelClass}>
          Clearcoat roughness ({draft.clearcoatRoughness.toFixed(2)})
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={draft.clearcoatRoughness}
            onChange={(e) => patch({ clearcoatRoughness: Number(e.target.value) })}
          />
        </label>
      </div>

    </div>
  );
}
