// src/components/admin/PromptsPage.tsx
//
// The software owner's prompt lab (§137). Up to five named prompts for
// Make image: opening and closing words, whether the design brief (JSON)
// is sent, and up to three reference photos of real kitchens. One is
// marked "Used by businesses"; none = the built-in prompt. To compare,
// pick a prompt next to Make image in a kitchen's 3D tab, make an image
// with each, then Images → Compare.

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Copy, ImagePlus, Plus, Trash2, Wand2, X } from 'lucide-react';
import { PageHeader } from '../shell/AppShell';
import { SectionCard } from '../common/SectionCard';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { useAuthStore } from '../../store/authStore';
import { confirmDialog } from '../../store/confirmDialogStore';
import { BUILT_IN_PROMPT, type ImagePrompt } from '../../lib/renders';
import {
  addReferencePhoto,
  createPrompt,
  deletePrompt,
  listPrompts,
  MAX_PROMPTS,
  MAX_REFERENCE_PHOTOS,
  removeReferencePhoto,
  savePrompt,
  setProductionPrompt,
  type SavedPrompt,
} from '../../lib/renderPrompts';

const textareaClass =
  'min-h-28 w-full rounded-[10px] border border-input bg-card px-3 py-2.5 text-[14px] leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-80';

function PromptFields({
  value,
  onChange,
  readOnly = false,
}: {
  value: ImagePrompt;
  onChange?: (v: ImagePrompt) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      {!readOnly && (
        <Label className="flex flex-col items-stretch gap-1.5 text-[13px] font-semibold">
          Name
          <Input value={value.name} maxLength={60} onChange={(e) => onChange?.({ ...value, name: e.target.value })} className="h-10 max-w-sm" />
        </Label>
      )}
      <Label className="flex flex-col items-stretch gap-1.5 text-[13px] font-semibold">
        Opening (read first)
        <textarea value={value.intro} readOnly={readOnly} onChange={(e) => onChange?.({ ...value, intro: e.target.value })} className={textareaClass} />
      </Label>
      <Label className="flex items-center gap-2 text-[13px] font-semibold">
        <Checkbox
          checked={value.includeBrief}
          disabled={readOnly}
          onCheckedChange={(c) => onChange?.({ ...value, includeBrief: c === true })}
        />
        Send the design brief (JSON: every cabinet, finish, size and the rules against inventing)
      </Label>
      <Label className="flex flex-col items-stretch gap-1.5 text-[13px] font-semibold">
        Closing (read last)
        <textarea value={value.closing} readOnly={readOnly} onChange={(e) => onChange?.({ ...value, closing: e.target.value })} className={`${textareaClass} min-h-16`} />
      </Label>
    </div>
  );
}

function References({ prompt, onChange }: { prompt: SavedPrompt; onChange: (p: SavedPrompt) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const full = prompt.referenceImages.length >= MAX_REFERENCE_PHOTOS;

  async function add(file: File) {
    setBusy(true);
    try {
      onChange(await addReferencePhoto(prompt, file));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Couldn’t add the photo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-semibold">
        Reference photos ({prompt.referenceImages.length} of {MAX_REFERENCE_PHOTOS})
      </span>
      <span className="text-[12px] text-muted-foreground">
        Real kitchens, sent after the camera pictures as “Reference photo 1, 2…”, for look and finish only. Say in the opening how to use them. Saved
        straight away.
      </span>
      <div className="flex flex-wrap gap-2">
        {prompt.referenceImages.map((r) => (
          <div key={r.path} className="relative">
            <img src={r.url} alt={r.label} className="h-24 w-36 rounded-lg border border-border object-cover" />
            <button
              type="button"
              aria-label={`Remove ${r.label}`}
              onClick={async () => {
                try {
                  onChange(await removeReferencePhoto(prompt, r));
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Couldn’t remove the photo.');
                }
              }}
              className="absolute top-1 right-1 flex size-7 items-center justify-center rounded-full bg-card/90 shadow"
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
        {!full && (
          <Button variant="outline" className="h-24 w-36 flex-col" disabled={busy} onClick={() => input.current?.click()}>
            <ImagePlus /> {busy ? 'Uploading…' : 'Add photo'}
          </Button>
        )}
        <input
          ref={input}
          type="file"
          accept="image/*"
          hidden
          aria-label="Reference photo"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void add(f);
          }}
        />
      </div>
    </div>
  );
}

function SavedPromptCard({
  prompt,
  onSaved,
  onDeleted,
}: {
  prompt: SavedPrompt;
  onSaved: (p: SavedPrompt) => void;
  onDeleted: () => void;
}) {
  const [draft, setDraft] = useState<ImagePrompt>(prompt);
  const [saving, setSaving] = useState(false);
  const dirty =
    draft.name !== prompt.name || draft.intro !== prompt.intro || draft.closing !== prompt.closing || draft.includeBrief !== prompt.includeBrief;

  async function save() {
    if (!draft.name.trim()) {
      toast.error('Give the prompt a name.');
      return;
    }
    setSaving(true);
    try {
      onSaved(await savePrompt({ ...draft, id: prompt.id }));
      toast.success(`Saved “${draft.name.trim()}”.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Couldn’t save.');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    const ok = await confirmDialog({
      title: `Delete “${prompt.name}”?`,
      description: prompt.isProduction
        ? 'Businesses use this prompt now; they’ll go back to the built-in one. Images already made keep its name.'
        : 'Images already made with it keep its name.',
      confirmLabel: 'Delete prompt',
    });
    if (!ok) return;
    try {
      await deletePrompt(prompt);
      onDeleted();
      toast.success('Prompt deleted.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Couldn’t delete.');
    }
  }

  return (
    <SectionCard
      Icon={Wand2}
      title={prompt.name}
      description={prompt.isProduction ? 'Used by businesses.' : 'For testing. Pick it next to Make image in a kitchen’s 3D tab.'}
    >
      <div className="flex flex-col gap-4">
        <PromptFields value={draft} onChange={setDraft} />
        <References prompt={prompt} onChange={onSaved} />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!dirty || saving} onClick={save}>
            {saving ? 'Saving…' : 'Save prompt'}
          </Button>
          {dirty && (
            <Button size="sm" variant="ghost" onClick={() => setDraft(prompt)}>
              Discard changes
            </Button>
          )}
          <span className="flex-1" />
          <Button size="sm" variant="ghost" onClick={remove}>
            <Trash2 /> Delete
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}

export function PromptsPage() {
  const isSuperAdmin = useAuthStore((s) => s.isSuperAdmin);
  const [prompts, setPrompts] = useState<SavedPrompt[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!isSuperAdmin) return;
    let live = true;
    listPrompts().then(
      (rows) => live && (setPrompts(rows), setError(null)),
      (err: unknown) => live && setError(err instanceof Error ? err.message : 'Couldn’t load the prompts.')
    );
    return () => {
      live = false;
    };
  }, [isSuperAdmin, reload]);

  if (!isSuperAdmin) {
    return (
      <div className="px-4 py-6 md:px-8 lg:px-10 lg:py-8">
        <PageHeader title="Prompts" />
        <p className="mt-4 text-[14px] text-muted-foreground">Only the software owner can see this page.</p>
      </div>
    );
  }

  const production = prompts?.find((p) => p.isProduction) ?? null;
  const full = (prompts?.length ?? 0) >= MAX_PROMPTS;

  async function makeNew(from: ImagePrompt, name: string) {
    try {
      const created = await createPrompt(from, name);
      setPrompts((prev) => [...(prev ?? []), created]);
      toast.success(`Added “${created.name}”.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Couldn’t add the prompt.');
    }
  }

  async function choose(id: string | null) {
    try {
      await setProductionPrompt(id);
      setReload((n) => n + 1);
      toast.success(`Businesses now use ${id ? `“${prompts?.find((p) => p.id === id)?.name}”` : 'the built-in prompt'}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Couldn’t change it.');
    }
  }

  return (
    <div className="flex flex-col gap-5 px-4 pt-6 pb-24 md:px-8 lg:px-10 lg:pt-8">
      <PageHeader title="Prompts" subtitle="What Make image tells the AI" />
      {error && (
        <p role="alert" className="rounded-xl bg-destructive/10 px-3.5 py-3 text-[14px] text-destructive">
          {error}
        </p>
      )}
      {prompts && (
        <>
          <SectionCard
            Icon={Wand2}
            title="Used by businesses"
            description="The prompt every business’s Make image uses. To compare prompts first: in a kitchen’s 3D tab, pick one next to Make image, make an image with each, then Images → Compare."
          >
            <div role="radiogroup" aria-label="Used by businesses" className="flex flex-col gap-2 text-[14px]">
              {[{ id: null as string | null, name: 'Built-in' }, ...prompts.map((p) => ({ id: p.id as string | null, name: p.name }))].map((o) => (
                <label key={o.id ?? 'built-in'} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="production-prompt"
                    checked={(production?.id ?? null) === o.id}
                    onChange={() => void choose(o.id)}
                    className="size-4 accent-[var(--primary)]"
                  />
                  {o.name}
                </label>
              ))}
            </div>
            <p className="mt-3 text-[12px] text-muted-foreground">
              Sent in this order: opening → design brief (if on) → the camera pictures (Camera 1’s line drawing and colour view, then the other
              cameras) → reference photos → closing.
            </p>
          </SectionCard>

          <SectionCard Icon={Wand2} title="Built-in" description="The app’s own prompt. Read-only: copy it to try changes.">
            <div className="flex flex-col gap-3">
              <PromptFields value={BUILT_IN_PROMPT} readOnly />
              <div>
                <Button size="sm" variant="outline" disabled={full} onClick={() => void makeNew(BUILT_IN_PROMPT, `Copy of built-in ${prompts.length + 1}`)}>
                  <Copy /> Copy into a new prompt
                </Button>
              </div>
            </div>
          </SectionCard>

          {prompts.map((p) => (
            <SavedPromptCard
              key={`${p.id}-${p.updatedAt}`}
              prompt={p}
              onSaved={(next) => setPrompts((prev) => prev?.map((x) => (x.id === next.id ? next : x)) ?? null)}
              onDeleted={() => setPrompts((prev) => prev?.filter((x) => x.id !== p.id) ?? null)}
            />
          ))}

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              disabled={full}
              onClick={() => void makeNew({ ...BUILT_IN_PROMPT, intro: '', closing: '' }, `Prompt ${prompts.length + 1}`)}
            >
              <Plus /> New blank prompt
            </Button>
            <span className="text-[13px] text-muted-foreground">
              {prompts.length} of {MAX_PROMPTS} saved{full ? ': delete one to add another.' : '.'}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
