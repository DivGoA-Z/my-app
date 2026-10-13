// src/components/help/HelpLauncher.tsx
//
// The round Help button (§129): floating at the bottom right of every page
// except Present (a customer-facing screen). In the design editor it sits
// just above the editor's bottom bar (and, on a phone, its tool strip);
// the 3D move pad and the item/quote panel make room for it.

import { CircleHelp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useHelpStore } from '../../store/helpStore';

export function HelpLauncher({ inEditor = false }: { inEditor?: boolean }) {
  const open = useHelpStore((s) => s.open);
  const setOpen = useHelpStore((s) => s.setOpen);
  const rightPx = useHelpStore((s) => s.editorRightPx);
  if (open) return null;
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="Help"
      title="Help"
      className={cn(
        'fixed z-40 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-float transition-transform hover:scale-105 active:scale-95',
        inEditor ? 'right-4 bottom-[148px] md:right-[var(--help-right)] md:bottom-[80px]' : 'right-4 bottom-[92px] md:right-6 md:bottom-6'
      )}
      // In the editor, beside its right-hand panel when one is open (on a
      // phone that panel covers the screen, so it stays at the edge).
      style={inEditor ? ({ '--help-right': `${rightPx + 24}px` } as React.CSSProperties) : undefined}
    >
      <CircleHelp className="size-7" strokeWidth={1.8} />
    </button>
  );
}
