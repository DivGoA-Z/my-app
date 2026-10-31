// @vitest-environment jsdom
//
// Password recovery (§133): "Forgot password?" on the sign-in screen
// sends a reset link without saying whether the account exists; opening
// the link shows "Set a new password", which checks length and the
// repeat before saving. No test reaches Supabase: the auth store's
// actions are spies.

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Session } from '@supabase/supabase-js';
import { LoginScreen } from '../auth/LoginScreen';
import { SetNewPasswordScreen } from '../auth/SetNewPasswordScreen';
import { useAuthStore } from '../../store/authStore';

function setAuth(overrides: Partial<ReturnType<typeof useAuthStore.getState>>) {
  useAuthStore.setState({
    session: null,
    businessId: null,
    isLoading: false,
    error: null,
    passwordRecovery: false,
    recoveryLinkError: null,
    signIn: vi.fn(async () => {}),
    sendPasswordReset: vi.fn(async () => {}),
    setNewPassword: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    ...overrides,
  });
}

describe('Forgot password', () => {
  it('sends a reset link to the typed email and says to check it', async () => {
    const user = userEvent.setup();
    const sendPasswordReset = vi.fn(async () => {});
    setAuth({ sendPasswordReset });
    render(<LoginScreen />);
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(screen.getByRole('heading', { name: 'Reset your password' })).toBeTruthy();
    await user.type(screen.getByLabelText('Email'), 'asha@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(sendPasswordReset).toHaveBeenCalledWith('asha@example.com');
    expect(screen.getByRole('status').textContent).toMatch(/If an account exists for asha@example\.com/);
    await user.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeTruthy();
  });

  it('shows Supabase’s error, e.g. too many emails', async () => {
    const user = userEvent.setup();
    setAuth({ sendPasswordReset: vi.fn(async () => Promise.reject(new Error('Email rate limit exceeded'))) });
    render(<LoginScreen />);
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }));
    await user.type(screen.getByLabelText('Email'), 'a@b.co');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(screen.getByText('Email rate limit exceeded')).toBeTruthy();
  });

  it('opens straight on the reset form when the emailed link failed', () => {
    setAuth({ recoveryLinkError: 'Email link is invalid or has expired' });
    render(<LoginScreen />);
    expect(screen.getByText(/That reset link didn’t work \(Email link is invalid or has expired\)/)).toBeTruthy();
  });
});

describe('Set a new password', () => {
  const session = { user: { id: 'u1', email: 'asha@example.com' } } as unknown as Session;

  it('checks length and the repeat before saving', async () => {
    const user = userEvent.setup();
    const setNewPassword = vi.fn(async () => {});
    setAuth({ session, passwordRecovery: true, setNewPassword });
    render(<SetNewPasswordScreen />);
    expect(screen.getByText('asha@example.com')).toBeTruthy();
    await user.type(screen.getByLabelText('New password'), 'short');
    await user.type(screen.getByLabelText('Type it again'), 'short');
    await user.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(screen.getByText('Use at least 8 characters.')).toBeTruthy();
    await user.clear(screen.getByLabelText('New password'));
    await user.type(screen.getByLabelText('New password'), 'kitchen-2026');
    await user.clear(screen.getByLabelText('Type it again'));
    await user.type(screen.getByLabelText('Type it again'), 'kitchen-2025');
    await user.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(screen.getByText('The two passwords don’t match.')).toBeTruthy();
    expect(setNewPassword).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText('Type it again'));
    await user.type(screen.getByLabelText('Type it again'), 'kitchen-2026');
    await user.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(setNewPassword).toHaveBeenCalledWith('kitchen-2026');
  });

  it('can sign out instead', async () => {
    const user = userEvent.setup();
    const signOut = vi.fn(async () => {});
    setAuth({ session, passwordRecovery: true, signOut });
    render(<SetNewPasswordScreen />);
    await user.click(screen.getByRole('button', { name: 'Sign out instead' }));
    expect(signOut).toHaveBeenCalled();
  });
});
