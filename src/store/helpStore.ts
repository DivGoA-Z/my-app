// src/store/helpStore.ts
//
// The help assistant's chat (§129): whether the panel is open, the
// conversation, and where the person is in the app — sent with each
// question, because "where is it?" depends on the screen they're on.
//
// The answer streams back from /api/help (worker/helpHandler.ts) as plain
// text and is appended as it arrives. The conversation lives for the
// session only; nothing is stored.

import { create } from 'zustand';
import { supabase } from '../lib/Supabaseclient';
import { useLayoutStore } from './layoutStore';
import { SELECTABLE_TYPE_LABELS } from '../types/selection';

export interface HelpMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  // An error shown in place of an answer; never sent back to the model.
  error?: boolean;
}

interface HelpState {
  open: boolean;
  messages: HelpMessage[];
  busy: boolean;
  // e.g. "Customers", "Design editor"; set by App.
  screen: string;
  // e.g. "Plan tab, Cabinets panel open"; set by the design editor.
  editorDetail: string | null;
  // Width (px) of the editor's right-hand panel (item settings or quote)
  // on a laptop/tablet, so the Help button sits beside it, not on it.
  editorRightPx: number;
  setEditorRightPx: (px: number) => void;
  setOpen: (open: boolean) => void;
  setScreen: (screen: string) => void;
  setEditorDetail: (detail: string | null) => void;
  ask: (question: string) => Promise<void>;
  clear: () => void;
}

// What the model is told about where the person is.
export function describeScreen(screen: string, editorDetail: string | null): string {
  const parts = [screen];
  if (editorDetail) parts.push(editorDetail);
  const selection = useLayoutStore.getState().selection;
  if (editorDetail && selection) parts.push(`a ${SELECTABLE_TYPE_LABELS[selection.type]} is selected`);
  return parts.join(' · ');
}

const id = () => crypto.randomUUID();

export const useHelpStore = create<HelpState>((set, get) => ({
  open: false,
  messages: [],
  busy: false,
  screen: 'Home',
  editorDetail: null,
  editorRightPx: 0,
  setEditorRightPx: (editorRightPx) => set({ editorRightPx }),
  setOpen: (open) => set({ open }),
  setScreen: (screen) => set({ screen }),
  setEditorDetail: (editorDetail) => set({ editorDetail }),
  clear: () => set({ messages: [] }),

  ask: async (question) => {
    const text = question.trim();
    if (!text || get().busy) return;
    const history = get().messages.filter((m) => !m.error);
    const answerId = id();
    set({
      busy: true,
      messages: [...get().messages, { id: id(), role: 'user', content: text }, { id: answerId, role: 'assistant', content: '' }],
    });
    const update = (patch: Partial<HelpMessage>) =>
      set({ messages: get().messages.map((m) => (m.id === answerId ? { ...m, ...patch } : m)) });

    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const res = await fetch('/api/help', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          messages: [...history.map(({ role, content }) => ({ role, content })), { role: 'user', content: text }],
          screen: describeScreen(get().screen, get().editorDetail),
        }),
      });
      if (!res.ok || !res.body) {
        const message = await res
          .json()
          .then((b: { error?: string }) => b.error)
          .catch(() => undefined);
        update({ content: message ?? 'The assistant isn’t available right now. Please try again in a moment.', error: true });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let answer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        update({ content: answer });
      }
      if (!answer.trim()) update({ content: 'No answer came back. Please try asking again.', error: true });
    } catch {
      update({ content: 'Couldn’t reach the assistant. Check your internet and try again.', error: true });
    } finally {
      set({ busy: false });
    }
  },
}));
