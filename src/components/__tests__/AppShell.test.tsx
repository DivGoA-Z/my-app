// @vitest-environment jsdom
//
// The business mark at the top of the sidebar (§95): the logo when the
// business has one, the first letter otherwise or if the image fails.

import { describe, expect, it, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AppShell } from '../shell/AppShell';
import { useAuthStore } from '../../store/authStore';

const profile = (logoUrl: string | null) => ({ name: 'Sharma Kitchens', phone: '', logoUrl, gstin: '', showGstin: false });

describe('sidebar business mark (§95)', () => {
  beforeEach(() => useAuthStore.setState({ businessName: 'Sharma Kitchens', businessProfile: profile(null) }));

  it('shows the initial when there is no logo', () => {
    render(<AppShell page="home" onNavigate={() => {}}>x</AppShell>);
    expect(screen.queryByAltText('Sharma Kitchens logo')).toBeNull();
    expect(screen.getByText('S')).toBeTruthy();
  });

  it('shows the uploaded logo, and falls back to the initial if it fails to load', () => {
    useAuthStore.setState({ businessProfile: profile('https://example.test/logo.png') });
    render(<AppShell page="home" onNavigate={() => {}}>x</AppShell>);
    const img = screen.getByAltText('Sharma Kitchens logo');
    expect(img.getAttribute('src')).toBe('https://example.test/logo.png');
    fireEvent.error(img);
    expect(screen.queryByAltText('Sharma Kitchens logo')).toBeNull();
    expect(screen.getByText('S')).toBeTruthy();
  });
});
