// Asks the 20 test questions to the local model (Ollama) with the guide as
// its system prompt, and writes the answers to answers.md for review.
// Reads the guide fresh every run, and rewrites the Modelfile for
// chatting with it in the terminal (ollama create kdb-helper -f …).
// Usage: node docs/chatbot/test/run-test.mjs [model]
import { readFileSync, writeFileSync } from 'node:fs';
const dir = new URL('.', import.meta.url).pathname;
const model = process.argv[2] ?? 'qwen3:4b-instruct-2507-q4_K_M';
const guide = readFileSync(dir + '../APP_GUIDE_FOR_ASSISTANT.md', 'utf8');
writeFileSync(
  dir + 'Modelfile',
  `FROM ${model}\n# The guide is ~6,000 tokens; the default context would cut it off.\nPARAMETER num_ctx 12288\nPARAMETER temperature 0.2\nSYSTEM """${guide}"""\n`
);
const questions = JSON.parse(readFileSync(dir + 'questions.json', 'utf8'));
let out = `# Test answers (${model}, ${new Date().toLocaleString()})\n\nFor each: does it name real buttons, is it correct, does it invent anything?\n`;
let flagged = 0;
for (const [i, t] of questions.entries()) {
  process.stdout.write(`${i + 1}/${questions.length} ${t.q} … `);
  const res = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    body: JSON.stringify({ model, stream: false, messages: [{ role: 'system', content: guide }, { role: 'user', content: t.q }], options: { temperature: 0.2, num_ctx: 12288 } }),
  });
  const answer = (await res.json()).message?.content ?? '(no answer)';
  const low = answer.toLowerCase();
  const missing = (t.mustMention ?? []).filter((w) => !low.includes(w.toLowerCase()));
  const bad = (t.mustNot ?? []).filter((w) => low.includes(w.toLowerCase()));
  const ok = !missing.length && !bad.length;
  if (!ok) flagged++;
  console.log(ok ? 'ok' : 'CHECK');
  out += `\n## ${i + 1}. ${t.q}\n\n${answer}\n\n${ok ? '✓ quick check passed' : `⚠ check: ${[...missing.map((m) => `missing "${m}"`), ...bad.map((b) => `mentions "${b}"`)].join(', ')}`}\n`;
}
writeFileSync(dir + 'answers.md', out);
console.log(`\nDone. ${flagged} of ${questions.length} flagged. Read docs/chatbot/test/answers.md`);
