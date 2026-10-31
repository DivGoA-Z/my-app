// "Make image" (§132): what's sent, and reading what comes back.
import { describe, expect, it } from 'vitest';
import { nearestAspect, pickRenderImage, renderParts } from './renders';
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
