// src/components/common/ConfirmDialog.tsx
//
// The single dialog every `confirmDialog(...)` call (see
// store/confirmDialogStore.ts) renders through. Mounted once in
// App.tsx, next to <Toaster/> — same "one global instance, called
// imperatively from anywhere" shape.

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import { useConfirmDialogStore } from '../../store/confirmDialogStore';

export function ConfirmDialog() {
  const { isOpen, title, description, confirmLabel, cancelLabel, destructive } =
    useConfirmDialogStore();

  function settle(value: boolean) {
    useConfirmDialogStore.getState().resolve?.(value);
    useConfirmDialogStore.setState({ isOpen: false, resolve: null });
  }

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && settle(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => settle(false)}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? 'destructive' : 'default'}
            onClick={() => settle(true)}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
