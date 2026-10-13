// src/components/help/HelpPanel.tsx
//
// The help assistant's chat panel (§129): slides in from the right over
// any page, so you can ask without leaving what you're doing. Answers
// stream in; the model writes light markdown (bold button names, numbered
// steps), rendered here without HTML injection (renderAnswer).

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CircleHelp, SendHorizontal, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useHelpStore, type HelpMessage } from '../../store/helpStore';
import { Button } from '../ui/button';

// Starters, per screen: the questions people get stuck on there.
const STARTERS: Record<string, string[]> = {
  'Design editor': ['How do I add a cabinet?', 'How do I rotate or delete an item?', 'Where is the cutting list?', 'How do I send the quote?'],
  Customers: ['How do I add a new customer?', 'How do I move a customer to Approved?', 'Where do I write notes?'],
  Catalogue: ['How do I add a new cabinet to my catalogue?', 'How do I add a new finish?', 'Can I reset my catalogue?'],
  'Rate card': ['How do I change the labour rate?', 'How do I add a transport charge?'],
  Production: ['How do I set the install date?', 'Where is the cutting list?'],
};
const DEFAULT_STARTERS = ['How do I start a new kitchen?', 'How do I make a quote?', 'Where do I find the cutting list?'];

// **bold** inside a line.
function inline(text: string, key: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
      <strong key={`${key}-${i}`} className="font-semibold">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    )
  );
}

// Paragraphs, numbered steps and bullets: all a short help answer needs.
function renderAnswer(text: string): ReactNode {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? 'ol' : 'ul';
    blocks.push(
      <Tag key={`l${blocks.length}`} className={cn('my-1 flex flex-col gap-1 pl-5', list.ordered ? 'list-decimal' : 'list-disc')}>
        {list.items.map((item, i) => (
          <li key={i}>{inline(item, `li${blocks.length}-${i}`)}</li>
        ))}
      </Tag>
    );
    list = null;
  };
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (numbered || bullet) {
      const ordered = !!numbered;
      if (list && list.ordered !== ordered) flush();
      if (!list) list = { ordered, items: [] };
      list.items.push((numbered ?? bullet)![1]);
      continue;
    }
    flush();
    if (line.trim()) blocks.push(<p key={`p${blocks.length}`}>{inline(line.replace(/^#+\s*/, ''), `p${blocks.length}`)}</p>);
  }
  flush();
  return blocks;
}

function Bubble({ m, waiting }: { m: HelpMessage; waiting: boolean }) {
  if (m.role === 'user') {
    return <div className="ml-10 self-end rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-[14px] text-primary-foreground">{m.content}</div>;
  }
  return (
    <div
      className={cn(
        'mr-6 flex flex-col gap-1.5 self-start rounded-2xl rounded-bl-md px-3.5 py-2.5 text-[14px] leading-relaxed',
        m.error ? 'bg-destructive/10 text-destructive' : 'bg-secondary text-foreground'
      )}
    >
      {m.content ? renderAnswer(m.content) : <WaitingNote waiting={waiting} />}
    </div>
  );
}

// "Thinking…", then — if the model is waking up on its server, which can
// take a while on the first question — say so instead of looking stuck.
function WaitingNote({ waiting }: { waiting: boolean }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => setSlow(true), 6000);
    return () => clearTimeout(t);
  }, [waiting]);
  return (
    <span className="text-muted-foreground">
      {slow ? 'Waking up the assistant — the first answer can take up to a minute…' : 'Thinking…'}
    </span>
  );
}

export function HelpPanel() {
  const { open, messages, busy, screen, setOpen, ask, clear } = useHelpStore();
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const send = (text: string) => {
    if (!text.trim() || busy) return;
    void ask(text);
    setDraft('');
  };
  const starters = STARTERS[screen] ?? DEFAULT_STARTERS;

  return (
    <aside
      role="dialog"
      aria-label="Help"
      onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] flex-col border-l border-border bg-card shadow-float"
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <CircleHelp className="size-5 text-primary" />
        <span className="flex-1 text-[17px] font-semibold">Help</span>
        {messages.length > 0 && (
          <Button variant="ghost" size="icon-touch" aria-label="Clear chat" title="Clear chat" onClick={clear}>
            <Trash2 />
          </Button>
        )}
        <Button variant="ghost" size="icon-touch" aria-label="Close help" onClick={() => setOpen(false)}>
          <X />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-[14px] text-muted-foreground">
              Stuck? Ask how to do anything in the app — in English or Hinglish. For example:
            </p>
            {starters.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => send(q)}
                className="rounded-xl border border-border px-3.5 py-2.5 text-left text-[14px] hover:border-primary/60 hover:bg-secondary"
              >
                {q}
              </button>
            ))}
          </div>
        ) : (
          messages.map((m, i) => <Bubble key={m.id} m={m} waiting={busy && i === messages.length - 1} />)
        )}
        <div ref={endRef} />
      </div>

      <form
        className="flex items-end gap-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter is a new line.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(draft);
            }
          }}
          rows={1}
          placeholder="Ask how to do something…"
          aria-label="Your question"
          className="max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-input bg-card px-3 py-2.5 text-[15px] outline-none focus:border-primary"
        />
        <Button type="submit" size="icon-touch" aria-label="Send" disabled={busy || !draft.trim()}>
          <SendHorizontal />
        </Button>
      </form>
      <p className="px-4 pb-3 text-[11px] text-muted-foreground">Answers come from an AI assistant and can be wrong.</p>
    </aside>
  );
}
