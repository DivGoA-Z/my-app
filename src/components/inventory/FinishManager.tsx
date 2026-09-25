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

const inputClass = 'w-full rounded border border-gray-300 px-2 py-1 text-xs';
const labelClass = 'flex flex-col gap-1 text-[11px] text-gray-600';

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
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">Finishes</h3>
          <p className="text-[11px] text-gray-500">
            The materials you actually stock. Cabinets reference these, and each one's price per
            m² feeds the quote.
          </p>
        </div>
        <Button size="sm" onClick={startNew}>
          + New Finish
        </Button>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
        {finishes.map((finish) => (
          <FinishCard
            key={finish.id}
            finish={finish}
            isEditing={editingId === finish.id}
            onEdit={() => startEdit(finish)}
            onDelete={() => handleDelete(finish)}
          />
        ))}
        {finishes.length === 0 && (
          <p className="col-span-full text-xs text-gray-400">
            No finishes yet — add one, or run supabase/schema.sql to seed the defaults.
          </p>
        )}
      </div>

      {draft && (
        <FinishEditor
          draft={draft}
          setDraft={setDraft}
          onSave={handleSave}
          onCancel={cancel}
          isNew={!finishes.some((f) => f.id === draft.id)}
        />
      )}
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
  if (finish.proceduralKind) {
    return (
      <div
        className={`flex h-full w-full items-center justify-center bg-linear-to-br from-amber-100 to-amber-300 text-[9px] text-amber-800 ${className}`}
      >
        {finish.proceduralKind}
      </div>
    );
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
  onDelete: () => void;
}

function FinishCard({ finish, isEditing, onEdit, onDelete }: FinishCardProps) {
  return (
    <div
      className={`flex overflow-hidden rounded-lg border ${
        isEditing ? 'border-blue-400 ring-1 ring-blue-200' : 'border-gray-200'
      }`}
    >
      <div className="h-16 w-16 shrink-0 border-r border-gray-200">
        <SwatchPreview finish={finish} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-2 py-1">
        <span className="truncate text-xs font-medium text-gray-800">
          {finish.brand ? `${finish.brand} ${finish.label}` : finish.label}
        </span>
        <span className="truncate text-[10px] text-gray-500">
          {finish.finishTypeLabel} · {PATTERN_CATEGORY_LABELS[finish.patternCategory]}
        </span>
        <span className="text-[10px] text-gray-400">₹{finish.pricePerSqM}/m²</span>
        <div className="flex gap-2">
          <Button variant="link" size="xs" className="h-auto p-0 text-[10px]" onClick={onEdit}>
            Edit
          </Button>
          <Button
            variant="link"
            size="xs"
            className="h-auto p-0 text-[10px] text-destructive"
            onClick={onDelete}
          >
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}

interface FinishEditorProps {
  draft: SurfaceFinish;
  setDraft: (finish: SurfaceFinish) => void;
  onSave: () => void;
  onCancel: () => void;
  isNew: boolean;
}

function FinishEditor({ draft, setDraft, onSave, onCancel, isNew }: FinishEditorProps) {
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

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-gray-300 bg-gray-50 p-4">
      <h4 className="text-xs font-semibold text-gray-700">
        {isNew ? 'New finish' : `Editing: ${draft.label || 'Untitled'}`}
      </h4>

      <div className="grid grid-cols-3 gap-2">
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

        <label className={labelClass}>
          Pattern
          <select
            value={draft.patternCategory}
            onChange={(e) => handleCategoryChange(e.target.value as PatternCategory)}
            className={inputClass}
          >
            {PATTERN_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {PATTERN_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>

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
      <div className="flex gap-3 border-t border-gray-200 pt-3">
        <div className="h-24 w-24 shrink-0 overflow-hidden rounded border border-gray-300">
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
              className="text-[11px]"
            />
          </label>
          {isUploading && <span className="text-[10px] text-gray-500">Uploading…</span>}
          {uploadError && <span className="text-[10px] text-red-600">{uploadError}</span>}

          {draft.albedoUrl ? (
            <Button
              variant="link"
              size="xs"
              className="h-auto self-start p-0 text-[10px]"
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
                className="h-7 w-16 cursor-pointer rounded border border-gray-300"
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
        <div className="grid grid-cols-2 gap-2 border-t border-gray-200 pt-3">
          <label className={labelClass}>
            Normal map URL
            <input
              value={draft.normalMapUrl ?? ''}
              onChange={(e) => patch({ normalMapUrl: e.target.value || undefined })}
              placeholder="/textures/wood/normal.jpg"
              className={inputClass}
            />
            <span className="text-[10px] text-gray-400">
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
            <span className="text-[10px] text-gray-400">
              Lets sheen vary across the surface — glossy tile against matte grout, which the
              single roughness slider below can't express.
            </span>
          </label>
        </div>
      )}

      {/* Physical scale + tiling — only meaningful for an image */}
      {draft.albedoUrl && (
        <div className="grid grid-cols-3 gap-2 border-t border-gray-200 pt-3">
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
          <label className={labelClass}>
            Tiling
            <select
              value={draft.tilingMode}
              onChange={(e) => patch({ tilingMode: e.target.value as TilingMode })}
              className={inputClass}
            >
              {TILING_MODES.map((m) => (
                <option key={m} value={m}>
                  {m === 'mirror' ? 'Mirror (hides seams)' : 'Repeat'}
                </option>
              ))}
            </select>
          </label>
          <p className="col-span-3 text-[10px] text-gray-400">
            Swatch size is the real area the photo covers — get this wrong and the pattern renders
            at the wrong scale. Mirror tiling flips alternate copies so photographed edges match;
            it costs a little symmetry but removes hard seams.
          </p>
        </div>
      )}

      {/* Relief + optical response */}
      <div className="grid grid-cols-2 gap-3 border-t border-gray-200 pt-3">
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
          <span className="text-[10px] text-gray-400">
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
          <span className="text-[10px] text-gray-400">0 = mirror, 1 = fully matte.</span>
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
          <span className="text-[10px] text-gray-400">
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

      <div className="flex gap-2 border-t border-gray-200 pt-3">
        <Button size="sm" onClick={onSave}>
          Save finish
        </Button>
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
