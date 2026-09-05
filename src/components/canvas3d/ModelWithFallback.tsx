// src/components/canvas3d/ModelWithFallback.tsx
//
// Shared "fail safely" wrapper extracted out of ApplianceModel.tsx (see
// its file header, point 3) so both ApplianceModel and FixtureModel
// degrade the same way: useGLTF suspends while loading and THROWS on a
// missing or malformed file, and an uncaught throw inside <Canvas>
// blanks the entire 3D view. A Suspense boundary handles the loading
// case; an error boundary (no hook equivalent exists, hence the class
// component) handles the throw — both fall back to the caller's plain
// primitive.

import { Component, Suspense } from 'react';
import type { ReactNode } from 'react';

interface ModelErrorBoundaryState {
  hasFailed: boolean;
}

class ModelErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode; logPrefix: string },
  ModelErrorBoundaryState
> {
  state: ModelErrorBoundaryState = { hasFailed: false };

  static getDerivedStateFromError(): ModelErrorBoundaryState {
    return { hasFailed: true };
  }

  componentDidCatch(error: unknown) {
    // Worth surfacing: a silently-boxed item would otherwise look like
    // the model URL simply hadn't been set.
    console.warn(`[${this.props.logPrefix}] failed to load model, falling back:`, error);
  }

  render() {
    return this.state.hasFailed ? this.props.fallback : this.props.children;
  }
}

export function ModelWithFallback({
  fallback,
  logPrefix,
  children,
}: {
  fallback: ReactNode;
  // Tags the console.warn so a failure is traceable to which renderer
  // (ApplianceModel vs FixtureModel) hit it.
  logPrefix: string;
  children: ReactNode;
}) {
  return (
    <ModelErrorBoundary fallback={fallback} logPrefix={logPrefix}>
      <Suspense fallback={fallback}>{children}</Suspense>
    </ModelErrorBoundary>
  );
}
