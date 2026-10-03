// src/components/inventory/useItemEditor.ts
//
// Editing state for one catalogue item in an EditPanel (§76): open it on
// a copy, change the copy, Save (add or update through the store) or
// Delete (after a confirm). Shared by every catalogue list so they all
// behave the same.

import { useState } from 'react';
import { toast } from 'sonner';
import { confirmDialog } from '../../store/confirmDialogStore';

// ---- Shared editing state ----

interface Editing<T> {
  draft: T;
  isNew: boolean;
}

export function useItemEditor<T extends { id: string; label: string }>(
  save: (item: T) => Promise<void>,
  remove: (id: string) => Promise<void>,
  prepare: (draft: T) => T = (d) => d
) {
  const [editing, setEditing] = useState<Editing<T> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = (draft: T, isNew: boolean) => {
    setError(null);
    setEditing({ draft, isNew });
  };
  const setDraft = (draft: T) => setEditing((e) => (e ? { ...e, draft } : e));

  async function commit() {
    if (!editing) return;
    if (!editing.draft.label.trim()) {
      setError('Give it a name first.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const now = new Date().toISOString();
      const item = editing.isNew ? { ...editing.draft, createdAt: now, updatedAt: now } : editing.draft;
      await save(prepare(item));
      toast.success(editing.isNew ? `Added "${item.label}"` : `Saved "${item.label}"`);
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  async function destroy() {
    if (!editing || editing.isNew) return;
    const { draft } = editing;
    if (!(await confirmDialog({ title: `Delete "${draft.label}"?`, description: "This can't be undone." }))) return;
    setSaving(true);
    try {
      await remove(draft.id);
      toast.success(`Deleted "${draft.label}"`);
      setEditing(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete.';
      setError(message);
      toast.error('Failed to delete', { description: message });
    } finally {
      setSaving(false);
    }
  }

  return { editing, open, close: () => setEditing(null), setDraft, commit, destroy, saving, error };
}

