import { crc32, deflateSync } from 'zlib';

/**
 * PNG files built byte by byte for the logo tests (PAC-181 review fixes):
 * a valid one, and ones whose header is fine but whose image data is not.
 */

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

export interface PngOptions {
  width?: number;
  height?: number;
  /** 2 = RGB, 6 = RGBA (decoded asynchronously by pdfkit). */
  colorType?: number;
  interlace?: 0 | 1;
  /** The IDAT payload; by default the deflated, valid pixels. */
  idat?: Buffer;
  /** Drop the trailing bytes of the file (a truncated upload). */
  truncate?: number;
}

/** Channels per pixel for the 8-bit colour types used here. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

/** White pixels, every scanline with filter byte 0. */
export function rawScanlines(
  width: number,
  height: number,
  colorType: number,
  filter = 0,
): Buffer {
  const stride = width * (CHANNELS[colorType] ?? 4);
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(
      Buffer.concat([Buffer.from([filter]), Buffer.alloc(stride, 255)]),
    );
  }
  return Buffer.concat(rows);
}

export function buildPng(options: PngOptions = {}): Buffer {
  const width = options.width ?? 2;
  const height = options.height ?? 2;
  const colorType = options.colorType ?? 6;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colorType;
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter method
  ihdr[12] = options.interlace ?? 0;
  const idat =
    options.idat ?? deflateSync(rawScanlines(width, height, colorType));
  const file = Buffer.concat([
    SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  return options.truncate ? file.subarray(0, -options.truncate) : file;
}
