/**
 * PROXY protocol header parsing (v1 and v2).
 *
 * ## Why this exists
 * A load balancer in TLS-passthrough mode forwards raw TCP, so the backend sees
 * the balancer's address as the source of every connection. That is not a
 * cosmetic loss: `TrustedProxyThrottlerGuard` keys rate limits on the client IP,
 * so without the real address every caller on the internet shares one bucket and
 * the public intake limits stop meaning anything.
 *
 * The PROXY protocol fixes it by prefixing each connection with a short header
 * naming the original peer. It is the only way to recover the client address
 * when the balancer cannot read the (encrypted) stream.
 *
 * ## Why it is parsed here rather than by a library
 * The header is a handful of bytes with a fixed layout, and the alternative is a
 * dependency that sits in front of every connection the platform accepts. The
 * parsing is small enough to read in one sitting and is covered by unit tests
 * for both versions plus the malformed cases.
 *
 * ## ⚠ Only enable this behind a proxy that actually sends it
 * A header is a claim about who the peer is. Trusting it from an arbitrary
 * client would let anyone assert any source address and evade — or forge —
 * rate limiting. It is gated by `EDGE_PROXY_PROTOCOL`, which must be true only
 * when every connection arrives through a balancer configured to send it.
 * Conversely, enabling it on the balancer without enabling it here corrupts the
 * first bytes of every TLS handshake.
 */

/** RFC-defined maximum for a v1 header line, including CRLF. */
const V1_MAX_LENGTH = 107;

const V1_PREFIX = Buffer.from('PROXY ');

/** The v2 signature: 12 bytes that cannot occur at the start of a TLS record. */
const V2_SIGNATURE = Buffer.from([
  0x0d, 0x0a, 0x0d, 0x0a, 0x00, 0x0d, 0x0a, 0x51, 0x55, 0x49, 0x54, 0x0a,
]);

const V2_HEADER_LENGTH = 16;

export interface ProxyProtocolResult {
  /**
   * The original client's address, or null when the header carries none —
   * a v2 `LOCAL` command (health checks send these) or an unspecified family.
   * Null means "no claim was made", which is different from a failure.
   */
  sourceAddress: string | null;
  /** Bytes consumed. The remainder of the buffer is the real stream. */
  consumed: number;
}

/** Thrown when the bytes are present but are not a valid header. */
export class ProxyProtocolError extends Error {}

/**
 * Does this connection begin with a PROXY header?
 *
 * `true` it does, `false` it definitely does not, `null` not enough bytes yet.
 *
 * ## Why "definitely does not" is worth knowing
 * A load balancer that prefixes forwarded traffic with a PROXY header does not
 * necessarily prefix its own HEALTH CHECKS — and the behaviour differs between
 * balancers. Guessing either way is a bad bet: assume a header and the health
 * check is dropped as malformed, so every backend is marked unhealthy while
 * serving perfectly; assume none and the header is read as the first line of an
 * HTTP request, which fails just as silently.
 *
 * Sniffing first lets a listener accept both, which is the only version of this
 * that cannot be wrong.
 */
export function looksLikeProxyProtocol(data: Buffer): boolean | null {
  if (data.length === 0) return null;

  // v2 is binary and starts with \r; v1 is the ASCII word PROXY. Neither can
  // begin a TLS handshake (0x16) or any HTTP method.
  if (data[0] === V2_SIGNATURE[0]) {
    const known = Math.min(data.length, V2_SIGNATURE.length);
    if (!data.subarray(0, known).equals(V2_SIGNATURE.subarray(0, known))) {
      return false;
    }
    return data.length >= V2_SIGNATURE.length ? true : null;
  }

  if (data[0] === V1_PREFIX[0]) {
    const known = Math.min(data.length, V1_PREFIX.length);
    if (!data.subarray(0, known).equals(V1_PREFIX.subarray(0, known))) {
      return false;
    }
    return data.length >= V1_PREFIX.length ? true : null;
  }

  return false;
}

/**
 * Parse a PROXY header from the front of `data`.
 *
 * Returns `null` when the buffer does not yet hold a complete header and the
 * caller should wait for more bytes. Throws when what is there cannot be a
 * valid header — which, with the protocol enabled, means the peer is not the
 * balancer we expect and the connection should be dropped rather than guessed
 * at.
 */
export function parseProxyProtocol(data: Buffer): ProxyProtocolResult | null {
  if (data.length === 0) return null;

  // v2 is checked first: its signature is binary and cannot be confused with
  // v1's ASCII, whereas a partial v1 read could otherwise look like garbage.
  if (data.length >= 1 && data[0] === V2_SIGNATURE[0]) {
    return parseV2(data);
  }

  if (data[0] === V1_PREFIX[0]) {
    return parseV1(data);
  }

  throw new ProxyProtocolError(
    'Connection did not begin with a PROXY protocol header. ' +
      'EDGE_PROXY_PROTOCOL is enabled, so every connection must carry one.',
  );
}

/**
 * `PROXY TCP4 192.0.2.1 198.51.100.1 56324 443\r\n`
 *
 * Also `PROXY UNKNOWN\r\n`, which a balancer sends for connections it cannot
 * describe and which carries no address.
 */
function parseV1(data: Buffer): ProxyProtocolResult | null {
  const end = data.indexOf('\r\n');
  if (end === -1) {
    // Not yet complete. Past the maximum length it never will be, so failing
    // here stops an endless read on a peer that is simply not speaking v1.
    if (data.length > V1_MAX_LENGTH) {
      throw new ProxyProtocolError('PROXY v1 header exceeded 107 bytes.');
    }
    return null;
  }

  const line = data.subarray(0, end).toString('ascii');
  const consumed = end + 2;

  if (!line.startsWith('PROXY ')) {
    throw new ProxyProtocolError('Malformed PROXY v1 header.');
  }

  const parts = line.split(' ');
  // ['PROXY', 'UNKNOWN'] is valid and describes nothing.
  if (parts[1] === 'UNKNOWN') return { sourceAddress: null, consumed };

  if (parts.length !== 6 || (parts[1] !== 'TCP4' && parts[1] !== 'TCP6')) {
    throw new ProxyProtocolError(`Malformed PROXY v1 header: ${line}`);
  }

  return { sourceAddress: parts[2], consumed };
}

function parseV2(data: Buffer): ProxyProtocolResult | null {
  if (data.length < V2_HEADER_LENGTH) {
    // Could still become a valid header; but if what we have already diverges
    // from the signature it never will.
    const known = Math.min(data.length, V2_SIGNATURE.length);
    if (!data.subarray(0, known).equals(V2_SIGNATURE.subarray(0, known))) {
      throw new ProxyProtocolError('Malformed PROXY v2 signature.');
    }
    return null;
  }

  if (!data.subarray(0, 12).equals(V2_SIGNATURE)) {
    throw new ProxyProtocolError('Malformed PROXY v2 signature.');
  }

  const versionCommand = data[12];
  if ((versionCommand & 0xf0) !== 0x20) {
    throw new ProxyProtocolError('Unsupported PROXY protocol version.');
  }
  const command = versionCommand & 0x0f;

  const family = data[13];
  const addressLength = data.readUInt16BE(14);
  const consumed = V2_HEADER_LENGTH + addressLength;

  if (data.length < consumed) return null;

  // LOCAL (0x00) describes no connection — health checks use it. PROXY is 0x01.
  if (command === 0x00) return { sourceAddress: null, consumed };
  if (command !== 0x01) {
    throw new ProxyProtocolError(`Unsupported PROXY v2 command ${command}.`);
  }

  const address = data.subarray(V2_HEADER_LENGTH, consumed);

  // 0x11 = TCP over IPv4, 0x21 = TCP over IPv6. Anything else (UNSPEC, UDP,
  // unix sockets) carries no address we can use for rate limiting.
  if (family === 0x11 && address.length >= 12) {
    return {
      sourceAddress: `${address[0]}.${address[1]}.${address[2]}.${address[3]}`,
      consumed,
    };
  }

  if (family === 0x21 && address.length >= 36) {
    const groups: string[] = [];
    for (let i = 0; i < 16; i += 2) {
      groups.push(address.readUInt16BE(i).toString(16));
    }
    return { sourceAddress: groups.join(':'), consumed };
  }

  return { sourceAddress: null, consumed };
}
