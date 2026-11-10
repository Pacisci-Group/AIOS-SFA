import { deflateSync } from 'zlib';
import { buildPng, rawScanlines } from './__fixtures__/png';
import { MAX_LOGO_DECODED_BYTES, usableLogo } from './probe-logo';

const png = (bytes: Buffer) => ({ bytes, contentType: 'image/png' as const });

describe('usableLogo', () => {
  it('keeps a valid PNG, with or without alpha', () => {
    for (const colorType of [2, 6]) {
      const logo = png(buildPng({ colorType }));
      expect(usableLogo(logo)).toBe(logo);
    }
  });

  it('refuses a PNG whose image data does not inflate', () => {
    const logo = png(buildPng({ idat: Buffer.from('not deflate data') }));
    expect(usableLogo(logo)).toBeNull();
  });

  it('refuses a PNG whose image data is short', () => {
    const half = rawScanlines(2, 2, 6).subarray(0, 5);
    expect(usableLogo(png(buildPng({ idat: deflateSync(half) })))).toBeNull();
  });

  it('refuses a scanline with an unknown filter byte', () => {
    const idat = deflateSync(rawScanlines(2, 2, 6, 9));
    expect(usableLogo(png(buildPng({ idat })))).toBeNull();
  });

  it('refuses a truncated file', () => {
    expect(usableLogo(png(buildPng({ truncate: 6 })))).toBeNull();
  });

  it('refuses an interlaced PNG', () => {
    expect(usableLogo(png(buildPng({ interlace: 1 })))).toBeNull();
  });

  it('refuses one that would decode past the limit', () => {
    // 4,000 × 4,000 RGBA: 64 MB of pixels from a file of a few kilobytes.
    const side = 4000;
    expect(side * side * 4).toBeGreaterThan(MAX_LOGO_DECODED_BYTES);
    const logo = png(
      buildPng({
        width: side,
        height: side,
        idat: deflateSync(Buffer.alloc(1)),
      }),
    );
    expect(usableLogo(logo)).toBeNull();
  });

  it('keeps a JPEG by its signature and refuses anything else', () => {
    const jpeg = {
      bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]),
      contentType: 'image/jpeg' as const,
    };
    expect(usableLogo(jpeg)).toBe(jpeg);
    expect(usableLogo(png(Buffer.from('<svg/>')))).toBeNull();
    expect(usableLogo(null)).toBeNull();
  });
});
