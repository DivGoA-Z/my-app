// @vitest-environment jsdom
//
// Screen tests for sign-up with approval (§106): the sign-in screen can
// switch to "Create an account", which sends name + business name with
// the request and tells the person to check their email when Supabase
// requires confirmation; an account with no business sees "Waiting for
// access", never the app. No test reaches Supabase: the auth store's
// actions are replaced with spies.

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Session } from '@supabase/supabase-js';
import { LoginScreen } from '../auth/LoginScreen';
import { AwaitingAccessScreen } from '../auth/AwaitingAccessScreen';
import { useAuthStore } from '../../store/authStore';

function setAuth(overrides: Partial<ReturnType<typeof useAuthStore.getState>>) {
  useAuthStore.setState({
    session: null,
    businessId: null,
    isLoading: false,
    error: null,
    signIn: vi.fn(async () => {}),
    signUp: vi.fn(async () => ({ needsEmailConfirmation: true })),
    recheckAccess: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    ...overrides,
  });
}

describe('Create an account', () => {
  it('sends name and business name, then says to check email', async () => {
    const user = userEvent.setup();
    const signUp = vi.fn(async () => ({ needsEmailConfirmation: true }));
    setAuth({ signUp });
    render(<LoginScreen />);
    await user.click(screen.getByRole('button', { name: 'Create an account' }));
    await user.type(screen.getByLabelText('Your name'), 'Asha Verma');
    await user.type(screen.getByLabelText('Business name'), 'Verma Interiors');
    await user.type(screen.getByLabelText('Email'), 'asha@example.com');
    await user.type(screen.getByLabelText('Password'), 'long-enough-1');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(signUp).toHaveBeenCalledWith({
      email: 'asha@example.com',
      password: 'long-enough-1',
      fullName: 'Asha Verma',
      businessName: 'Verma Interiors',
    });
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeTruthy();
    expect(screen.getByText('asha@example.com')).toBeTruthy();
  });

  it('refuses a short password before asking Supabase', async () => {
    const user = userEvent.setup();
    const signUp = vi.fn(async () => ({ needsEmailConfirmation: false }));
    setAuth({ signUp });
    render(<LoginScreen />);
    await user.click(screen.getByRole('button', { name: 'Create an account' }));
    await user.type(screen.getByLabelText('Your name'), 'A');
    await user.type(screen.getByLabelText('Business name'), 'B');
    await user.type(screen.getByLabelText('Email'), 'a@example.com');
    const pw = screen.getByLabelText('Password') as HTMLInputElement;
    await user.type(pw, 'short');
    // Bypass the browser's own minLength check to reach ours.
    pw.removeAttribute('minLength');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(signUp).not.toHaveBeenCalled();
    expect(screen.getByText(/at least 8 characters/)).toBeTruthy();
  });

  it('shows Supabase\'s error when sign-up fails', async () => {
    const user = userEvent.setup();
    setAuth({ signUp: vi.fn(async () => { throw new Error('Signups not allowed for this instance'); }) });
    render(<LoginScreen />);
    await user.click(screen.getByRole('button', { name: 'Create an account' }));
    await user.type(screen.getByLabelText('Your name'), 'A');
    await user.type(screen.getByLabelText('Business name'), 'B');
    await user.type(screen.getByLabelText('Email'), 'a@example.com');
    await user.type(screen.getByLabelText('Password'), 'long-enough-1');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Signups not allowed for this instance')).toBeTruthy();
  });
});

describe('Waiting for access', () => {
  it('names the account, checks again on request, and can sign out', async () => {
    const user = userEvent.setup();
    const recheckAccess = vi.fn(async () => {});
    const signOut = vi.fn(async () => {});
    setAuth({ session: { user: { id: 'u1', email: 'asha@example.com' } } as unknown as Session, recheckAccess, signOut });
    render(<AwaitingAccessScreen />);
    expect(screen.getByRole('heading', { name: 'Waiting for access' })).toBeTruthy();
    expect(screen.getByText('asha@example.com')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    expect(recheckAccess).toHaveBeenCalled();
    expect(await screen.findByText(/Not linked yet/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalled();
  });
});
