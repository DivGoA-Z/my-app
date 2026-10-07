// src/components/toolbar/CameraMovePad.tsx
//
// Six hold-to-move buttons for fine-tuning a camera's position (§103):
// press and hold, the camera glides slowly in that direction (relative to
// where it looks — lib/cameraMove.ts); let go, it stops. Watch the 3D
// walkthrough while doing it; the view follows.
//
// The glide is a requestAnimationFrame loop started on pointerdown and
// stopped on pointerup / cancel / lost capture, with pointer capture so
// sliding off the button mid-press still ends it cleanly. Each frame is
// an ordinary updateCamera, which the store groups into ONE undo step per
// press (same edit signature, debounced). Keyboard: Enter/Space on a
// button moves a short step per key repeat.

import { useEffect, useRef } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronsDown, ChevronsUp } from 'lucide-react';
import { useLayoutStore } from '../../store/layoutStore';
import { moveCamera, type CameraMove } from '../../lib/cameraMove';
import { Button } from '../ui/button';

const KEY_STEP_S = 1 / 15; // one key repeat ≈ 20mm

const BUTTONS: { move: CameraMove; label: string; Icon: typeof ArrowUp; area: string }[] = [
  { move: 'forward', label: 'Forward', Icon: ArrowUp, area: 'col-start-2 row-start-1' },
  { move: 'left', label: 'Left', Icon: ArrowLeft, area: 'col-start-1 row-start-2' },
  { move: 'right', label: 'Right', Icon: ArrowRight, area: 'col-start-3 row-start-2' },
  { move: 'back', label: 'Back', Icon: ArrowDown, area: 'col-start-2 row-start-3' },
  { move: 'up', label: 'Up', Icon: ChevronsUp, area: 'col-start-5 row-start-1' },
  { move: 'down', label: 'Down', Icon: ChevronsDown, area: 'col-start-5 row-start-3' },
];

export function CameraMovePad({ cameraId }: { cameraId: string }) {
  const updateCamera = useLayoutStore((s) => s.updateCamera);
  // `last` is null until the first frame, which supplies the start time;
  // reading a clock here would be an impure call as far as the React
  // compiler can see.
  const loopRef = useRef<{ raf: number; last: number | null; move: CameraMove } | null>(null);

  // Read the camera and room fresh each step, never from a closure: the
  // loop runs across many renders.
  function step(move: CameraMove, seconds: number) {
    const { cameras, currentLayout } = useLayoutStore.getState();
    const cam = cameras.find((c) => c.id === cameraId);
    if (!cam || !currentLayout) return;
    const { widthMm, depthMm, ceilingHeightMm = 2700 } = currentLayout.dimensions;
    updateCamera(cameraId, moveCamera(cam, move, seconds, { widthMm, depthMm, ceilingHeightMm }));
  }

  function stop() {
    if (loopRef.current) cancelAnimationFrame(loopRef.current.raf);
    loopRef.current = null;
  }

  function start(move: CameraMove) {
    stop();
    const tick = (now: number) => {
      const loop = loopRef.current;
      if (!loop) return;
      // Capped so a stalled tab doesn't jump the camera on resume.
      if (loop.last !== null) step(loop.move, Math.min(0.1, (now - loop.last) / 1000));
      loop.last = now;
      loop.raf = requestAnimationFrame(tick);
    };
    loopRef.current = { raf: requestAnimationFrame(tick), last: null, move };
  }

  // Never leave a loop running past this panel.
  useEffect(() => stop, []);

  return (
    <div className="grid grid-cols-[repeat(5,2.25rem)] grid-rows-[repeat(3,2.25rem)] gap-1" role="group" aria-label="Move camera">
      {BUTTONS.map(({ move, label, Icon, area }) => (
        <Button
          key={move}
          type="button"
          variant="outline"
          size="icon"
          aria-label={`Move camera ${label.toLowerCase()}`}
          title={`Hold to move ${label.toLowerCase()}`}
          className={`${area} size-9 touch-none select-none`}
          onPointerDown={(e) => {
            // Optional call: jsdom (screen tests) has no pointer capture.
            e.currentTarget.setPointerCapture?.(e.pointerId);
            start(move);
          }}
          onPointerUp={stop}
          onPointerCancel={stop}
          onLostPointerCapture={stop}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              step(move, KEY_STEP_S);
            }
          }}
        >
          <Icon />
        </Button>
      ))}
      <span className="col-start-4 row-start-2 self-center text-center text-[11px] text-muted-foreground">height</span>
    </div>
  );
}
