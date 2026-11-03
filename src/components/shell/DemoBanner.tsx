// src/components/shell/DemoBanner.tsx
//
// The public demo account (§138): says, once per visit, that changes
// aren't saved. Small and dismissible, floating at the top, so it sits
// over the full-screen editor without pushing its layout down.

import { useState } from 'react';
import { X } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';

export function DemoBanner() {
  const isDemo = useAuthStore((s) => s.isDemo);
  const [hidden, setHidden] = useState(false);
  if (!isDemo || hidden) return null;
  return (
    <div
      role="status"
      className="fixed top-2 left-1/2 z-[60] flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-2 rounded-full bg-sidebar px-4 py-1.5 text-[13px] text-white shadow-float"
    >
      <span>
        <strong className="font-semibold text-sidebar-primary">Demo account.</strong> Change anything: nothing is saved, and a refresh starts over. AI
        features are off.
      </span>
      <button type="button" aria-label="Hide" onClick={() => setHidden(true)} className="flex size-6 shrink-0 items-center justify-center rounded-full hover:bg-white/10">
        <X className="size-4" />
      </button>
    </div>
  );
}
