// @vitest-environment jsdom
//
// The prompt lab (§137): only the software owner sees it; saved prompts
// are editable, one can be chosen for businesses (or the built-in one),
// and a new one starts from the built-in words. The prompt functions are
// mocked: nothing here reaches Supabase.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PromptsPage } from '../admin/PromptsPage';
import { useAuthStore } from '../../store/authStore';
import { createPrompt, savePrompt, setProductionPrompt } from '../../lib/renderPrompts';
import { BUILT_IN_PROMPT } from '../../lib/renders';

const saved = {
  id: 'p1',
  name: 'Strict',
  intro: 'Follow the brief exactly.',
  closing: 'One image.',
  includeBrief: true,
  referenceImages: [],
  isProduction: false,
  updatedAt: '2026-11-02T10:00:00Z',
};

vi.mock('../../lib/renderPrompts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/renderPrompts')>();
  return {
    ...real,
    listPrompts: vi.fn(async () => [saved]),
    createPrompt: vi.fn(async (from: { intro: string; closing: string; includeBrief: boolean }, name: string) => ({ ...saved, ...from, id: 'p2', name })),
    savePrompt: vi.fn(async (p: object) => ({ ...saved, ...p, updatedAt: '2026-11-02T11:00:00Z' })),
    setProductionPrompt: vi.fn(async () => {}),
  };
});

beforeEach(() => useAuthStore.setState({ isSuperAdmin: true }));

describe('Prompts page', () => {
  it('is the software owner’s only', () => {
    useAuthStore.setState({ isSuperAdmin: false });
    render(<PromptsPage />);
    expect(screen.getByText('Only the software owner can see this page.')).toBeTruthy();
  });

  it('shows the built-in prompt read-only, and each saved prompt editable', async () => {
    const user = userEvent.setup();
    render(<PromptsPage />);
    expect(await screen.findByRole('heading', { name: 'Strict' })).toBeTruthy();
    const openings = screen.getAllByLabelText('Opening (read first)') as HTMLTextAreaElement[];
    expect(openings[0].value).toBe(BUILT_IN_PROMPT.intro);
    expect(openings[0].readOnly).toBe(true);
    await user.clear(openings[1]);
    await user.type(openings[1], 'Warm evening light.');
    await user.click(screen.getByRole('button', { name: 'Save prompt' }));
    expect(savePrompt).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', intro: 'Warm evening light.' }));
  });

  it('chooses the prompt businesses use', async () => {
    const user = userEvent.setup();
    render(<PromptsPage />);
    await screen.findByRole('heading', { name: 'Strict' });
    expect((screen.getByRole('radio', { name: 'Built-in' }) as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole('radio', { name: 'Strict' }));
    expect(setProductionPrompt).toHaveBeenCalledWith('p1');
  });

  it('copies the built-in prompt into a new one', async () => {
    const user = userEvent.setup();
    render(<PromptsPage />);
    await screen.findByRole('heading', { name: 'Strict' });
    await user.click(screen.getByRole('button', { name: 'Copy into a new prompt' }));
    expect(createPrompt).toHaveBeenCalledWith(BUILT_IN_PROMPT, 'Copy of built-in 2');
    expect(await screen.findByRole('heading', { name: 'Copy of built-in 2' })).toBeTruthy();
  });
});
