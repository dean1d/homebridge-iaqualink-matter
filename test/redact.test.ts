import { describe, expect, it } from 'vitest';
import { redact } from '../src/diagnostics/redact.js';

describe('redact', () => {
  it('removes credentials', () => expect(redact({ username: 'a@b.com', token: 'secret', ok: true })).toEqual({ username: '[REDACTED]', token: '[REDACTED]', ok: true }));
  it('removes nested account and session identifiers', () => expect(redact({
    accountId: 'private-account',
    nested: { serial_number: 'private-serial', sessionID: 'private-session' },
  })).toEqual({
    accountId: '[REDACTED]',
    nested: { serial_number: '[REDACTED]', sessionID: '[REDACTED]' },
  }));
  it('redacts secrets embedded in strings', () => expect(redact(
    'Authorization: Bearer abc.def.ghi for owner@example.com',
  )).toBe('Authorization: Bearer [REDACTED] for [REDACTED_EMAIL]'));
});
