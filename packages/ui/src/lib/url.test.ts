import { describe, expect, test } from 'bun:test';

import { getExternalFaviconUrl } from './url';

describe('url helpers', () => {
  test('does not request external favicons for loopback or private hosts', () => {
    expect(getExternalFaviconUrl('http://127.0.0.1:3020')).toBeNull();
    expect(getExternalFaviconUrl('http://localhost:3020')).toBeNull();
    expect(getExternalFaviconUrl('http://0.0.0.0:3020')).toBeNull();
    expect(getExternalFaviconUrl('http://[::1]:3020')).toBeNull();
    expect(getExternalFaviconUrl('https://192.168.2.100/app')).toBeNull();
    expect(getExternalFaviconUrl('https://10.0.0.5/app')).toBeNull();
    expect(getExternalFaviconUrl('https://172.16.0.10/app')).toBeNull();
    expect(getExternalFaviconUrl('https://host.local/app')).toBeNull();
  });

  test('uses DuckDuckGo favicon proxy for public http URLs', () => {
    expect(getExternalFaviconUrl('https://example.com/path')).toBe('https://icons.duckduckgo.com/ip3/example.com.ico');
  });
});
