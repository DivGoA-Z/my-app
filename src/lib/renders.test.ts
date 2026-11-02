// "Make image" (§132): what's sent, and reading what comes back.
import { describe, expect, it } from 'vitest';
import { BUILT_IN_PROMPT, nearestAspect, pickRenderImage, promptAsText, renderParts } from './renders';
import type { RenderBrief } from './renderBrief';

describe('the request', () => {
  it('sends the brief, then each picture under its file name, in order', () => {
    const brief = { schema: 'kitchen-render-brief/v1', prompt: { imagePrompt: 'A kitchen.' } } as unknown as RenderBrief;
    const parts = renderParts(brief, [
      { file: 'k-guide.png', mimeType: 'image/png', data: 'L' },
      { file: 'k-colour.jpg', mimeType: 'image/jpeg', data: 'C' },
    ]);
    expect(parts[0]).toMatchObject({ text: expect.stringMatching(/ONE photorealistic photograph/) });
    expect(JSON.parse((parts[1] as { text: string }).text).prompt.imagePrompt).toBe('A kitchen.');
    expect(parts.slice(2, 6)).toEqual([
      { text: 'File "k-guide.png":' },
      { image: { mimeType: 'image/png', data: 'L' } },
      { text: 'File "k-colour.jpg":' },
      { image: { mimeType: 'image/jpeg', data: 'C' } },
    ]);
    expect(parts).toHaveLength(7);
  });

  it('picks the nearest aspect ratio Gemini accepts', () => {
    expect(nearestAspect(1024, 576)).toBe('16:9');
    expect(nearestAspect(1000, 1000)).toBe('1:1');
    expect(nearestAspect(800, 600)).toBe('4:3');
    expect(nearestAspect(750, 1000)).toBe('3:4');
  });
});

describe('the reply', () => {
  it('takes the final image, not the Pro model’s draft “thought” images', () => {
    const reply = {
      candidates: [
        {
          content: {
            parts: [
              { thought: true, inlineData: { mimeType: 'image/png', data: 'DRAFT' } },
              { text: 'Here is the kitchen.' },
              { inlineData: { mimeType: 'image/jpeg', data: 'FINAL' } },
            ],
          },
        },
      ],
    };
    expect(pickRenderImage(reply)).toEqual({ mimeType: 'image/jpeg', data: 'FINAL' });
  });

  it('says why when there is no image', () => {
    expect(pickRenderImage({ candidates: [{ finishReason: 'SAFETY', content: { parts: [{ text: 'I can’t make that.' }] } }] })).toEqual({
      error: 'No image came back (SAFETY). The model said: “I can’t make that.”',
    });
    expect(pickRenderImage({ promptFeedback: { blockReason: 'OTHER' } })).toEqual({ error: 'No image came back (OTHER).' });
  });
});

describe('prompts (§137)', () => {
  const brief = { prompt: { imagePrompt: 'A kitchen.' } } as unknown as RenderBrief;
  const cam = [{ file: 'k-guide.png', mimeType: 'image/png' as const, data: 'L' }];

  it('the built-in prompt is what Make image always sent', () => {
    const parts = renderParts(brief, cam);
    expect(parts[0]).toEqual({ text: BUILT_IN_PROMPT.intro });
    expect(parts.at(-1)).toEqual({ text: BUILT_IN_PROMPT.closing });
  });

  it('a saved prompt: its words, the brief only if on, reference photos after the cameras', () => {
    const prompt = { id: 'p1', name: 'Loose', intro: '  Make it warm.  ', closing: '', includeBrief: false };
    const parts = renderParts(brief, cam, prompt, [{ mimeType: 'image/jpeg', data: 'R1' }]);
    expect(parts).toEqual([
      { text: 'Make it warm.' },
      { text: 'File "k-guide.png":' },
      { image: { mimeType: 'image/png', data: 'L' } },
      { text: 'Reference photo 1 (a real kitchen, for look and finish only):' },
      { image: { mimeType: 'image/jpeg', data: 'R1' } },
    ]);
  });

  it('See prompt shows every text, and where each picture goes', () => {
    const text = promptAsText(renderParts(brief, cam, { ...BUILT_IN_PROMPT, includeBrief: false }));
    expect(text).toBe(`${BUILT_IN_PROMPT.intro}\n\nFile "k-guide.png":\n\n[picture: image/png]\n\n${BUILT_IN_PROMPT.closing}`);
  });
});
