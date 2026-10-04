// src/components/panorama/PanoramaViewerModal.tsx
//
// Step 3 of the walkthrough architecture — an internal-only modal that
// loads a captured panorama (Step 2, lib/panoramaCapture.ts +
// lib/panoramaStorage.ts) via @photo-sphere-viewer/core, so a "Capture
// 360°" can immediately be checked without leaving the app. Opened from
// "View 360° Street View" buttons on CameraToolbar.tsx and
// CustomerDashboard.tsx.
//
// Scope note: this is the in-editor preview only, per the literal ask
// ("buttons ... so we can open and test the 360 panoramic walkthrough")
// — NOT the public, no-login client-facing link described in the
// broader narrative (WhatsApp share, hotspot arrows between nodes).
// That's a bigger separate feature (routing + anonymous Supabase
// access) to build later if wanted; this just proves a capture looks
// right.
//
// Install: npm install @photo-sphere-viewer/core

import { useEffect, useRef } from 'react';
import { Viewer } from '@photo-sphere-viewer/core';
import '@photo-sphere-viewer/core/index.css';
import { Button } from '../ui/button';

export interface PanoramaViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  // The camera node's label ("Sink View") — just for the modal title.
  cameraLabel: string;
  // null/undefined means this node hasn't been captured yet — the
  // modal shows a short explanation instead of trying to load nothing.
  panoramaUrl?: string | null;
}

export function PanoramaViewerModal({
  isOpen,
  onClose,
  cameraLabel,
  panoramaUrl,
}: PanoramaViewerModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);

  // Mount/tear down the actual photo-sphere-viewer instance alongside
  // the modal's own open/close and the panorama URL it should show —
  // NOT just on mount, since re-opening for a DIFFERENT camera node
  // needs a fresh viewer pointed at the new image. destroy() is
  // required here (not just letting the DOM node get garbage
  // collected) — photo-sphere-viewer attaches its own WebGL context
  // and event listeners that otherwise leak every time this modal
  // re-opens.
  useEffect(() => {
    if (!isOpen || !panoramaUrl || !containerRef.current) {
      return;
    }

    const viewer = new Viewer({
      container: containerRef.current,
      panorama: panoramaUrl,
      navbar: ['zoom', 'fullscreen'],
    });
    viewerRef.current = viewer;

    return () => {
      viewer.destroy();
      viewerRef.current = null;
    };
  }, [isOpen, panoramaUrl]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className="flex h-full w-full max-w-4xl flex-col gap-3 rounded-lg bg-white p-4 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">360° Street View — {cameraLabel}</h3>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            ×
          </Button>
        </div>

        {panoramaUrl ? (
          <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden rounded" />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded border border-dashed border-input text-sm text-muted-foreground">
            <p>This camera hasn't been captured yet.</p>
            <p className="text-xs text-muted-foreground">
              Open 3D Preview, lock onto "{cameraLabel}", and click "Capture 360°" first.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
