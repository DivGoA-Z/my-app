// @vitest-environment jsdom
//
// Screen test for the Cameras panel's height and tilt boxes (§102): they
// commit on Enter / leaving the box, clamped, never mid-typing.

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CameraToolbar } from '../toolbar/CameraToolbar';
import { resetStore } from '../../test/store';
import { useLayoutStore } from '../../store/layoutStore';
import { layout } from '../../test/fixtures';
import type { CameraNode } from '../../types/Camera';

const cam: CameraNode = {
  id: 'cam-1',
  layoutId: 'layout-1',
  label: 'Doorway',
  x: 1500,
  y: 2500,
  viewAngleDeg: 0,
  heightMm: 1600,
  createdAt: '',
  updatedAt: '',
};

function setup() {
  const updateCamera = vi.fn((id: string, updates: Partial<CameraNode>) => {
    useLayoutStore.setState((s) => ({ cameras: s.cameras.map((c) => (c.id === id ? { ...c, ...updates } : c)) }));
  });
  resetStore({ currentLayout: layout({ dimensions: { widthMm: 3000, depthMm: 3000, ceilingHeightMm: 2700 } }), cameras: [cam], updateCamera });
  render(<CameraToolbar />);
  return updateCamera;
}

describe('Cameras panel', () => {
  it('lets you type a full height and saves it on Enter', async () => {
    const user = userEvent.setup();
    const updateCamera = setup();
    const box = screen.getByLabelText('Doorway eye height in mm');
    await user.clear(box);
    await user.type(box, '1450');
    expect(updateCamera).not.toHaveBeenCalled(); // nothing saved mid-typing
    await user.keyboard('{Enter}');
    expect(updateCamera).toHaveBeenCalledWith('cam-1', { heightMm: 1450 });
  });

  it('clamps tilt to ±60° and puts back an empty box', async () => {
    const user = userEvent.setup();
    const updateCamera = setup();
    const tilt = screen.getByLabelText('Doorway tilt in degrees');
    await user.clear(tilt);
    await user.type(tilt, '-80');
    await user.tab();
    expect(updateCamera).toHaveBeenLastCalledWith('cam-1', { pitchDeg: -60 });
    const height = screen.getByLabelText('Doorway eye height in mm');
    await user.clear(height);
    await user.tab();
    expect(updateCamera).toHaveBeenCalledTimes(1);
    expect((height as HTMLInputElement).value).toBe('1600');
  });
});

describe('Move pad', () => {
  it('glides while held and stops when let go', async () => {
    let frame: FrameRequestCallback | null = null;
    let now = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => ((frame = cb), 1));
    vi.stubGlobal('cancelAnimationFrame', () => (frame = null));
    const updateCamera = setup();
    const forward = screen.getByRole('button', { name: 'Move camera forward' });
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.pointerDown(forward, { pointerId: 1 });
    // Three frames, 100ms apart (the first only sets the clock).
    for (let i = 0; i < 3; i++) {
      const cb = frame!;
      frame = null;
      cb((now += 100));
    }
    fireEvent.pointerUp(forward, { pointerId: 1 });
    expect(frame).toBeNull(); // stopped
    // Facing north: 0.2s at 300mm/s = 60mm towards the north wall.
    expect(useLayoutStore.getState().cameras[0].y).toBe(2500 - 60);
    expect(updateCamera).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it('moves a short step per Enter for keyboard users', async () => {
    const user = userEvent.setup();
    setup();
    screen.getByRole('button', { name: 'Move camera up' }).focus();
    await user.keyboard('{Enter}');
    expect(useLayoutStore.getState().cameras[0].heightMm).toBe(1613);
  });
});
