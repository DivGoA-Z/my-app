// src/hooks/useUndoRedoShortcuts.ts
//
// Cmd+Z / Cmd+Shift+Z drive the store's undo()/redo() globally (Ctrl+
// in place of Cmd on non-Mac, since this is a laptop-first tool and
// nothing else in the app is Mac-only). Skipped entirely while focus
// is inside a text input, textarea or select, so the browser's own
// native undo for THAT field fires instead of being hijacked mid-edit.

import { useEffect } from 'react';
import { useLayoutStore } from '../store/layoutStore';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export function useUndoRedoShortcuts() {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      if (isEditableTarget(e.target)) return;

      e.preventDefault();
      const { undo, redo } = useLayoutStore.getState();
      if (e.shiftKey) {
        redo();
      } else {
        undo();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
