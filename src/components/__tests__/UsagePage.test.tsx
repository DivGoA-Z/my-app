// @vitest-environment jsdom
//
// The Usage page (§132, §134): everyone sees their own business's usage
// with a straight-line projection; only the software owner also sees the
// default limits and every business. The usage functions are mocked:
// nothing here reaches Supabase.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fetchBusinessRenders } from '../../lib/usageAdmin';
import { UsagePage } from '../admin/UsagePage';
import { useAuthStore } from '../../store/authStore';

const limits = { images_per_day: 20, images_per_week: 100, images_per_month: 300, tokens_per_day: 500000, tokens_per_week: null, tokens_per_month: 8000000 };

vi.mock('../../lib/usageAdmin', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/usageAdmin')>();
  return {
    ...real,
    fetchMyUsage: vi.fn(async () => ({
      limits,
      used: { images_day: 12, images_week: 12, images_month: 300, tokens_day: 0, tokens_week: 90000, tokens_month: 120000 },
      // Wednesday noon, India time.
      now: new Date('2026-11-04T12:00:00+05:30'),
    })),
    fetchBusinessRenders: vi.fn(async () => [
      {
        id: 'r1',
        createdAt: '2026-11-02T10:15:00+05:30',
        cameraLabel: 'Camera 1',
        styling: 'styled',
        model: 'gemini-3-pro-image-preview',
        imageUrl: 'https://img.example/r1.png',
        clientName: 'Neha Verma',
        designName: 'Kitchen',
      },
    ]),
    fetchUsageOverview: vi.fn(async () => ({
      defaults: limits,
      businesses: [
        {
          id: 'b1',
          name: 'Sharma Kitchens',
          own: null,
          limits,
          used: { images_day: 1, images_week: 1, images_month: 1, tokens_day: 0, tokens_week: 0, tokens_month: 0 },
        },
      ],
    })),
  };
});

beforeEach(() => useAuthStore.setState({ isSuperAdmin: false }));

describe('Usage page', () => {
  it('a normal login sees its own usage and when it runs out, nothing else', async () => {
    render(<UsagePage />);
    expect(await screen.findByText('At this rate: runs out around 8:00 pm today.')).toBeTruthy();
    expect(screen.getByText('Your usage')).toBeTruthy();
    expect(screen.getByText('Limit reached: resets on 1 Dec.')).toBeTruthy();
    expect(screen.getByText('Nothing used yet.')).toBeTruthy();
    expect(screen.getAllByText(/used · no limit/)).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: 'Default limits' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Businesses' })).toBeNull();
    expect(screen.queryByText('Sharma Kitchens')).toBeNull();
  });

  it('the software owner also sees the defaults and every business', async () => {
    useAuthStore.setState({ isSuperAdmin: true });
    render(<UsagePage />);
    expect(await screen.findByText('Sharma Kitchens')).toBeTruthy();
    expect(screen.getByText('Your usage')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Default limits' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Businesses' })).toBeTruthy();
  });

  it('the software owner opens a business’s images, with customer and design (§136)', async () => {
    const user = userEvent.setup();
    useAuthStore.setState({ isSuperAdmin: true });
    render(<UsagePage />);
    await screen.findByText('Sharma Kitchens');
    await user.click(screen.getByRole('button', { name: 'Images' }));
    expect(await screen.findByText('Neha Verma · Kitchen')).toBeTruthy();
    expect(fetchBusinessRenders).toHaveBeenCalledWith('b1');
    await user.click(screen.getByRole('button', { name: /AI image for Neha Verma/ }));
    expect(screen.getByRole('dialog').textContent).toMatch(/Sharma Kitchens · 2 Nov.*Camera 1 · Styled · gemini-3-pro-image-preview/);
    expect(screen.getByRole('link', { name: /Download/ }).getAttribute('href')).toBe('https://img.example/r1.png');
  });
});
