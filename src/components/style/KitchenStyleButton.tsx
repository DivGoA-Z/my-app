// src/components/style/KitchenStyleButton.tsx
//
// "Style" in the editor's top bar (§117): this kitchen's default finish,
// colour, handle and board for base, wall and tall cabinets. A change
// applies at once to every cabinet still on the old default; cabinets
// set by hand are left alone, and the dialog offers to change those too.
// Starts from the business's defaults until the kitchen changes one.

import { useState } from 'react';
import { Palette } from 'lucide-react';
import { useLayoutStore } from '../../store/layoutStore';
import {
  EMPTY_STYLE_DEFAULTS,
  effectiveStyleDefaults,
  planStyleChange,
  type StyleChangePlan,
  type StyleDefaults,
} from '../../lib/styleDefaults';
import { StyleDefaultsEditor } from './StyleDefaultsEditor';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '../ui/dialog';

export function KitchenStyleButton({ compact = false }: { compact?: boolean }) {
  const business = useLayoutStore((s) => s.businessStyleDefaults);
  const project = useLayoutStore((s) => s.projectStyleDefaults);
  const setProjectStyleDefaults = useLayoutStore((s) => s.setProjectStyleDefaults);
  const patchCabinets = useLayoutStore((s) => s.patchCabinets);
  const value = effectiveStyleDefaults(business ?? undefined, project ?? undefined);
  // Cabinets the last change left alone because they were set by hand.
  const [handSet, setHandSet] = useState<StyleChangePlan['handSet']>([]);

  // "Before" is read from the store at the moment of the change, never
  // from this render (§118): a colour drag calls this many times from one
  // render's closure, and a stale "before" made every cabinet the first
  // step had moved look hand-set, so they all stuck on the drag's first
  // colour while the default ended on the last.
  function change(next: StyleDefaults | null) {
    const s = useLayoutStore.getState();
    const before = effectiveStyleDefaults(s.businessStyleDefaults ?? undefined, s.projectStyleDefaults ?? undefined);
    const after = next ?? s.businessStyleDefaults ?? EMPTY_STYLE_DEFAULTS;
    const plan = planStyleChange(s.cabinets, before, after);
    setProjectStyleDefaults(next, plan.follow);
    // A drag's later steps find nothing new set by hand; keep the notice
    // from the step that did.
    if (plan.handSet.length || plan.follow.length) setHandSet(plan.handSet);
  }

  return (
    <Dialog onOpenChange={() => setHandSet([])}>
      <DialogTrigger asChild>
        {compact ? (
          <Button variant="outline" size="icon-touch" aria-label="Kitchen style">
            <Palette />
          </Button>
        ) : (
          <Button variant="outline" size="touch">
            <Palette /> Style
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Kitchen style</DialogTitle>
          <DialogDescription>
            Defaults for this kitchen. New cabinets take them, and a change updates every cabinet still on the old
            default; one you set by hand keeps its own.
            {project ? '' : ' Starting from your business defaults.'}
          </DialogDescription>
        </DialogHeader>

        {handSet.length > 0 && (
          <div role="status" className="flex items-center justify-between gap-3 rounded-xl bg-warning-soft px-3 py-2 text-[13px] text-warning-foreground">
            <span>
              {handSet.length === 1
                ? '1 cabinet was set by hand, so it kept its own.'
                : `${handSet.length} cabinets were set by hand, so they kept their own.`}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                patchCabinets(handSet);
                setHandSet([]);
              }}
            >
              Change {handSet.length === 1 ? 'it' : 'them'} too
            </Button>
          </div>
        )}

        <StyleDefaultsEditor value={value} onChange={change} />

        {project && (
          <Button variant="ghost" size="sm" className="self-start" onClick={() => change(null)}>
            Use my business defaults
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
