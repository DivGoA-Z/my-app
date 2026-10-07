// src/components/inventory/DefaultCatalogueCard.tsx
//
// "Your default catalogue" (§107), at the top of the Catalogue page: save
// the catalogue as it is now as this business's default, or go back to
// the saved default. A new business starts with the starter catalogue
// saved as its default, so going back works from day one.
//
// Going back resets edited items (prices included) and restores deleted
// ones; items added since are kept. Open quotes priced from a reset item
// move with it, so the confirm says so. Frozen quotes never change.

import { useEffect, useState } from 'react';
import { Bookmark } from 'lucide-react';
import { toast } from 'sonner';
import { SectionCard } from '../common/SectionCard';
import { Button } from '../ui/button';
import { confirmDialog } from '../../store/confirmDialogStore';
import { useAuthStore } from '../../store/authStore';
import { useLayoutStore } from '../../store/layoutStore';
import { fetchDefaultSavedAt, restoreMyCatalogDefault, saveMyCatalogDefault } from '../../lib/catalogDefaults';

export function DefaultCatalogueCard() {
  const businessId = useAuthStore((s) => s.businessId);
  const loadInventory = useLayoutStore((s) => s.loadInventory);
  // undefined = still loading; null = never saved.
  const [savedAt, setSavedAt] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState<'save' | 'restore' | null>(null);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    fetchDefaultSavedAt(businessId).then((at) => {
      if (!cancelled) setSavedAt(at);
    });
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  async function handleSave() {
    const ok = await confirmDialog({
      title: 'Save the catalogue as your default?',
      description: savedAt
        ? 'This replaces your saved default with the catalogue exactly as it is now.'
        : 'You can go back to the catalogue exactly as it is now, any time.',
      confirmLabel: 'Save as default',
      destructive: false,
    });
    if (!ok) return;
    setBusy('save');
    try {
      const n = await saveMyCatalogDefault();
      setSavedAt(new Date().toISOString());
      toast.success(`Saved ${n} items as your default catalogue.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the default.');
    } finally {
      setBusy(null);
    }
  }

  async function handleRestore() {
    const ok = await confirmDialog({
      title: 'Go back to your default catalogue?',
      description:
        'Items you edited go back to their saved values, prices included, and items you deleted come back. Items added since are kept. Open quotes using a reset item will show its saved price; frozen quotes never change.',
      confirmLabel: 'Go back to default',
      destructive: true,
    });
    if (!ok) return;
    setBusy('restore');
    try {
      const n = await restoreMyCatalogDefault();
      await loadInventory();
      toast.success(`Restored ${n} items from your default catalogue.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not go back to the default.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <SectionCard
      Icon={Bookmark}
      title="Your default catalogue"
      description="Save the catalogue as it is now, and go back to it whenever you like."
      help={
        <p>
          A new business starts with our starter catalogue saved as its default. Change, delete or add
          items freely. "Go back to my default" puts edited items back to their saved values and brings
          back deleted ones; anything you added since stays. "Save as my default" makes the catalogue as
          it is now the version you go back to.
        </p>
      }
    >
      <div className="flex flex-wrap items-center gap-3 px-4 py-4 md:px-6">
        <p className="mr-auto text-[15px] text-muted-foreground">
          {savedAt === undefined
            ? 'Checking…'
            : savedAt
              ? `Default saved ${new Date(savedAt).toLocaleString()}.`
              : 'No default saved yet.'}
        </p>
        <Button variant="outline" size="touch" onClick={handleSave} disabled={busy !== null}>
          {busy === 'save' ? 'Saving…' : 'Save as my default'}
        </Button>
        <Button variant="outline" size="touch" onClick={handleRestore} disabled={busy !== null || !savedAt}>
          {busy === 'restore' ? 'Restoring…' : 'Go back to my default'}
        </Button>
      </div>
    </SectionCard>
  );
}
