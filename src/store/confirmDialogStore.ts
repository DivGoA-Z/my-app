// src/store/confirmDialogStore.ts
//
// A single imperative confirm dialog, mirroring how `toast()` works
// (sonner) — call `confirmDialog({...})` from anywhere, no hook, no
// per-caller dialog markup, and it resolves to true/false once the
// user answers. One <ConfirmDialog/> (components/common/ConfirmDialog.tsx)
// is mounted once at the app root and renders whatever this store's
// state currently holds — replaces every `window.confirm(...)` call,
// which is a native browser popup outside the app's own styling.

import { create } from 'zustand';

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for a destructive action. Default true, since
   * every caller so far is a delete. */
  destructive?: boolean;
}

interface ConfirmDialogState extends ConfirmOptions {
  isOpen: boolean;
  resolve: ((value: boolean) => void) | null;
}

export const useConfirmDialogStore = create<ConfirmDialogState>(() => ({
  isOpen: false,
  title: '',
  description: undefined,
  confirmLabel: 'Delete',
  cancelLabel: 'Cancel',
  destructive: true,
  resolve: null,
}));

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    // Settles any dialog already open (shouldn't normally happen —
    // one confirm at a time) with `false` rather than leaving its
    // promise dangling forever.
    useConfirmDialogStore.getState().resolve?.(false);
    useConfirmDialogStore.setState({
      title: options.title,
      description: options.description,
      confirmLabel: options.confirmLabel ?? 'Delete',
      cancelLabel: options.cancelLabel ?? 'Cancel',
      destructive: options.destructive ?? true,
      isOpen: true,
      resolve,
    });
  });
}
