// @vitest-environment jsdom
// The help assistant's chat panel (§129). The relay is mocked: this
// checks the panel, not the model.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HelpPanel } from '../help/HelpPanel';
import { useHelpStore } from '../../store/helpStore';

afterEach(() => {
  vi.restoreAllMocks();
  useHelpStore.setState({ open: false, messages: [], busy: false, screen: 'Home', editorDetail: null });
});

describe('HelpPanel', () => {
  it('is hidden until opened, then offers questions for the current screen', () => {
    const { rerender } = render(<HelpPanel />);
    expect(screen.queryByRole('dialog', { name: 'Help' })).toBeNull();
    useHelpStore.setState({ open: true, screen: 'Design editor' });
    rerender(<HelpPanel />);
    expect(screen.getByRole('button', { name: 'How do I add a cabinet?' })).toBeInTheDocument();
  });

  it('sends the question with where the person is, and shows the answer as it streams', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('1. Press **Cutting list**'));
            c.enqueue(new TextEncoder().encode(' in the top bar.'));
            c.close();
          },
        })
      )
    );
    useHelpStore.setState({ open: true, screen: 'Design editor', editorDetail: 'Plan tab' });
    render(<HelpPanel />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Your question' }), 'where is cutting list{Enter}');

    await waitFor(() => expect(screen.getByText('Cutting list', { selector: 'strong' })).toBeInTheDocument());
    expect(screen.getByText('where is cutting list')).toBeInTheDocument();
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(body.screen).toBe('Design editor · Plan tab');
    expect(body.messages.at(-1)).toEqual({ role: 'user', content: 'where is cutting list' });
  });

  it('shows the relay’s message when the assistant is unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'The help assistant isn’t set up yet.' }), { status: 503 })
    );
    useHelpStore.setState({ open: true });
    render(<HelpPanel />);
    await userEvent.click(screen.getByRole('button', { name: 'How do I make a quote?' }));
    await waitFor(() => expect(screen.getByText('The help assistant isn’t set up yet.')).toBeInTheDocument());
  });
});
