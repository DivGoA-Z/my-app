// Tests for the pipeline stage change (§69): Lost carries its reason,
// any other stage clears it, and every change stamps status_changed_at.

import { describe, expect, it } from 'vitest';
import { statusChangeRow } from './customers';

const now = '2026-10-03T10:00:00.000Z';

describe('statusChangeRow', () => {
  it('Lost writes its reason and note', () => {
    expect(statusChangeRow({ status: 'Lost', reason: 'price', note: ' Too costly ' }, now)).toEqual({
      status: 'Lost',
      status_changed_at: now,
      updated_at: now,
      lost_reason: 'price',
      lost_note: 'Too costly',
    });
  });
  it('any other stage clears a previous reason', () => {
    expect(statusChangeRow({ status: 'Installed' }, now)).toMatchObject({ status: 'Installed', lost_reason: null, lost_note: null, status_changed_at: now });
  });
});
