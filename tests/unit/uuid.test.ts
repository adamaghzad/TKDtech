import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClientUuid } from '../../apps/web/lib/uuid';

afterEach(() => vi.unstubAllGlobals());

describe('browser-compatible event UUIDs', () => {
  it('uses native randomUUID when available', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'native-uuid' });
    expect(createClientUuid()).toBe('native-uuid');
  });

  it('uses secure getRandomValues on plain-HTTP LAN browsers without randomUUID', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        for (let index = 0; index < bytes.length; index += 1) bytes[index] = index;
        return bytes;
      },
    });
    expect(createClientUuid()).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
  });

  it('produces unique RFC v4 identifiers through the compatibility path', () => {
    const native = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: native.getRandomValues.bind(native) });
    const values = new Set(Array.from({ length: 200 }, () => createClientUuid()));
    expect(values.size).toBe(200);
    for (const value of values) expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('gives a useful error instead of failing with randomUUID is not a function', () => {
    vi.stubGlobal('crypto', undefined);
    expect(() => createClientUuid()).toThrow(/securely create event IDs.*retry pairing/i);
  });
});
