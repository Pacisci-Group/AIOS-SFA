import type { Readable } from 'stream';

/**
 * A stream's bytes, refusing more than `maxBytes` — for the agency logo the
 * statement embeds (PAC-181), which is read from object storage.
 */
export async function readAll(
  stream: Readable,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      stream.destroy();
      throw new Error(`The file is larger than ${maxBytes} bytes.`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}
