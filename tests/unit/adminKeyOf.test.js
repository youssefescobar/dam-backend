import { describe, it, expect } from '@jest/globals';
import { adminKeyOf } from '../../src/services/storage.js';

describe('adminKeyOf (which stored URLs are our uploads)', () => {
  const key = 'admin/2026-10/3cf7dea5-e8c1-4356-8d65-189f2d0aff40.webp';

  it('reads the key from our upload URL, whatever the host', () => {
    expect(adminKeyOf(`https://pub-383eae3e298b4e5e88b7ad729f8cb60a.r2.dev/${key}`)).toBe(key);
    expect(adminKeyOf(`https://cdn.example.com/${key}`)).toBe(key);
  });

  it('ignores pasted links, chat files and empty values', () => {
    expect(adminKeyOf('https://example.com/photo.jpg')).toBeNull();
    expect(adminKeyOf('https://cdn.test/chat/6ad9015f1e22eca9f1354ffd/3cf7dea5-e8c1-4356-8d65-189f2d0aff40.pdf')).toBeNull();
    expect(adminKeyOf('/images/cover.jpg')).toBeNull();
    expect(adminKeyOf('')).toBeNull();
    expect(adminKeyOf(undefined)).toBeNull();
  });
});
