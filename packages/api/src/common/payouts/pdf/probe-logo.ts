import { inflateSync } from 'zlib';
import type { StatementPdfLogo } from './statement-pdf-model';

/**
 * Whether pdfkit can embed a logo without failing out of reach (PAC-181
 * review fixes).
 *
 * pdfkit reads a PNG's header synchronously, but decodes the pixels of one
 * with an alpha channel (colour type 4 or 6), a transparent palette or
 * interlacing **asynchronously**, in png-js's `zlib.inflate` callback. Bad
 * image data there is thrown from the callback: no try/catch around
 * `doc.image()` sees it, the process takes an uncaught exception, and the
 * document never ends. So every PNG is decoded here first, synchronously and
 * inside a try, the way png-js will decode it; anything doubtful is refused,
 * and the agency's name — which the band always prints — stands in.
 *
 * A JPEG is embedded synchronously, so `doc.image()`'s own try/catch covers
 * it; only its signature is checked here.
 */

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

/**
 * The most decoded pixel data a logo may hold — about 2,800 × 2,800 RGBA.
 * pdfkit holds the pixels, the colour and the alpha channel at once, so a
 * small file that inflates to gigabytes must never reach it.
 */
export const MAX_LOGO_DECODED_BYTES = 32 * 1024 * 1024;

/** Samples per pixel by PNG colour type. */
const CHANNELS: Readonly<Record<number, number>> = {
  0: 1, // greyscale
  2: 3, // RGB
  3: 1, // palette
  4: 2, // greyscale + alpha
  6: 4, // RGBA
};

/** Bit depths the PNG specification allows for each colour type. */
const BIT_DEPTHS: Readonly<Record<number, readonly number[]>> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};

/** The logo when pdfkit can embed it safely, else `null`. */
export function usableLogo(
  logo: StatementPdfLogo | null,
): StatementPdfLogo | null {
  if (!logo) return null;
  const bytes = logo.bytes;
  if (startsWith(bytes, PNG_SIGNATURE)) {
    return pngDecodes(bytes) ? logo : null;
  }
  if (startsWith(bytes, JPEG_SIGNATURE)) return logo;
  return null;
}

function startsWith(bytes: Buffer, prefix: Buffer): boolean {
  return (
    bytes.length >= prefix.length &&
    bytes.subarray(0, prefix.length).equals(prefix)
  );
}

/**
 * Walks the chunks, inflates the joined IDAT data and checks every
 * scanline's filter byte — the two things png-js throws on in its callback.
 */
function pngDecodes(bytes: Buffer): boolean {
  try {
    let pos = PNG_SIGNATURE.length;
    let header: {
      width: number;
      height: number;
      bitDepth: number;
      colorType: number;
      interlace: number;
    } | null = null;
    const idat: Buffer[] = [];
    let ended = false;

    while (pos + 8 <= bytes.length) {
      const length = bytes.readUInt32BE(pos);
      const type = bytes.toString('latin1', pos + 4, pos + 8);
      const dataStart = pos + 8;
      const dataEnd = dataStart + length;
      // The chunk and its CRC must lie inside the file.
      if (dataEnd + 4 > bytes.length) return false;
      const data = bytes.subarray(dataStart, dataEnd);
      if (header === null && type !== 'IHDR') return false;
      if (type === 'IHDR') {
        if (length !== 13) return false;
        header = {
          width: data.readUInt32BE(0),
          height: data.readUInt32BE(4),
          bitDepth: data[8],
          colorType: data[9],
          interlace: data[12],
        };
      } else if (type === 'IDAT') {
        idat.push(data);
      } else if (type === 'IEND') {
        ended = true;
        break;
      }
      pos = dataEnd + 4;
    }

    if (!header || !ended || idat.length === 0) return false;
    const { width, height, bitDepth, colorType, interlace } = header;
    if (width === 0 || height === 0) return false;
    if (!BIT_DEPTHS[colorType]?.includes(bitDepth)) return false;
    // Interlaced data is laid out in seven passes; a logo has no need of it.
    if (interlace !== 0) return false;

    const stride = Math.ceil((width * CHANNELS[colorType] * bitDepth) / 8);
    const expected = height * (stride + 1);
    if (expected > MAX_LOGO_DECODED_BYTES) return false;

    const pixels = inflateSync(Buffer.concat(idat), {
      // A little slack for an encoder's trailing bytes, never a bomb.
      maxOutputLength: expected + 1024,
    });
    if (pixels.length < expected) return false;
    for (let row = 0; row < height; row += 1) {
      // Filter types 0–4: anything else is png-js's "Invalid filter algorithm".
      if (pixels[row * (stride + 1)] > 4) return false;
    }
    return true;
  } catch {
    return false;
  }
}
