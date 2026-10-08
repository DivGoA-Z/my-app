// src/components/style/BusinessStyleCard.tsx
//
// The business's kitchen style defaults (§117), on the Catalogue page:
// what every new kitchen starts with. Saved on each change. Existing
// kitchens' cabinets aren't touched; a kitchen that has its own defaults
// keeps them.

import { useState } from 'react';
import { Palette } from 'lucide-react';
import { toast } from 'sonner';
import { SectionCard } from '../common/SectionCard';
import { useLayoutStore } from '../../store/layoutStore';
import { EMPTY_STYLE_DEFAULTS, type StyleDefaults } from '../../lib/styleDefaults';
import { StyleDefaultsEditor } from './StyleDefaultsEditor';

export function BusinessStyleCard() {
  const saved = useLayoutStore((s) => s.businessStyleDefaults);
  const save = useLayoutStore((s) => s.saveBusinessStyleDefaults);
  // Shown at once; the store follows when the database accepts it.
  const [draft, setDraft] = useState<StyleDefaults | null>(null);
  const value = draft ?? saved ?? EMPTY_STYLE_DEFAULTS;

  async function change(next: StyleDefaults) {
    setDraft(next);
    try {
      await save(next);
      setDraft(null);
    } catch (err) {
      setDraft(null);
      toast.error(err instanceof Error ? err.message : 'Could not save the defaults.');
    }
  }

  return (
    <SectionCard
      Icon={Palette}
      title="Default kitchen style"
      description="What every new kitchen starts with: finish, colour, handle and board for base, wall and tall cabinets. Each kitchen can change its own from Style in the editor. Saved as you go."
    >
      <StyleDefaultsEditor value={value} onChange={change} />
    </SectionCard>
  );
}
