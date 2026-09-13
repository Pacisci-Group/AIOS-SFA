import { ProxyProtocolError, parseProxyProtocol } from './proxy-protocol';

const V2_SIGNATURE = Buffer.from([
  0x0d, 0x0a, 0x0d, 0x0a, 0x00, 0x0d, 0x0a, 0x51, 0x55, 0x49, 0x54, 0x0a,
]);

/** Build a v2 header: signature, ver/cmd, family, length, address block. */
function v2(
  command: number,
  family: number,
  address: Buffer,
  trailing = Buffer.alloc(0),
): Buffer {
  const head = Buffer.alloc(4);
  head[0] = 0x20 | command;
  head[1] = family;
  head.writeUInt16BE(address.length, 2);
  return Buffer.concat([V2_SIGNATURE, head, address, trailing]);
}

describe('PROXY protocol v1', () => {
  it('reads the client address from a TCP4 header', () => {
    const data = Buffer.from('PROXY TCP4 192.0.2.1 198.51.100.7 56324 443\r\n');

    expect(parseProxyProtocol(data)).toEqual({
      sourceAddress: '192.0.2.1',
      consumed: data.length,
    });
  });

  it('reads a TCP6 header', () => {
    const data = Buffer.from(
      'PROXY TCP6 2001:db8::1 2001:db8::2 56324 443\r\n',
    );

    expect(parseProxyProtocol(data)?.sourceAddress).toBe('2001:db8::1');
  });

  /**
   * The header is a prefix, not the whole connection. Getting `consumed` wrong
   * by even one byte corrupts the TLS handshake that follows, which surfaces as
   * every connection failing for no visible reason.
   */
  it('consumes only the header, leaving the stream intact', () => {
    const header = Buffer.from('PROXY TCP4 192.0.2.1 198.51.100.7 1 2\r\n');
    const body = Buffer.from([0x16, 0x03, 0x01, 0x00, 0x05]);

    const result = parseProxyProtocol(Buffer.concat([header, body]));

    expect(result?.consumed).toBe(header.length);
  });

  /** A balancer sends this for a connection it cannot describe. */
  it('accepts UNKNOWN and reports no address', () => {
    const result = parseProxyProtocol(Buffer.from('PROXY UNKNOWN\r\n'));

    expect(result).toEqual({ sourceAddress: null, consumed: 15 });
  });

  it('waits for more bytes when the line is incomplete', () => {
    expect(parseProxyProtocol(Buffer.from('PROXY TCP4 192.0.2.1'))).toBeNull();
  });

  /**
   * Without a ceiling, a peer that never sends CRLF would be buffered forever —
   * an unauthenticated way to consume memory on the one process listening to
   * the internet.
   */
  it('gives up once the line exceeds the protocol maximum', () => {
    const tooLong = Buffer.concat([
      Buffer.from('PROXY TCP4 '),
      Buffer.from('9'.repeat(200)),
    ]);

    expect(() => parseProxyProtocol(tooLong)).toThrow(ProxyProtocolError);
  });

  it('rejects a header with the wrong field count', () => {
    expect(() =>
      parseProxyProtocol(Buffer.from('PROXY TCP4 192.0.2.1 443\r\n')),
    ).toThrow(ProxyProtocolError);
  });
});

describe('PROXY protocol v2', () => {
  it('reads an IPv4 client address', () => {
    const address = Buffer.alloc(12);
    Buffer.from([192, 0, 2, 1]).copy(address, 0);
    Buffer.from([198, 51, 100, 7]).copy(address, 4);
    address.writeUInt16BE(56324, 8);
    address.writeUInt16BE(443, 10);

    expect(parseProxyProtocol(v2(0x01, 0x11, address))).toEqual({
      sourceAddress: '192.0.2.1',
      consumed: 16 + 12,
    });
  });

  it('reads an IPv6 client address', () => {
    const address = Buffer.alloc(36);
    // 2001:db8:: — first two groups set, the rest zero.
    address.writeUInt16BE(0x2001, 0);
    address.writeUInt16BE(0x0db8, 2);

    const result = parseProxyProtocol(v2(0x01, 0x21, address));

    expect(result?.sourceAddress).toBe('2001:db8:0:0:0:0:0:0');
    expect(result?.consumed).toBe(16 + 36);
  });

  /** LOCAL describes no connection — balancer health checks send these. */
  it('accepts a LOCAL command with no address', () => {
    expect(parseProxyProtocol(v2(0x00, 0x00, Buffer.alloc(0)))).toEqual({
      sourceAddress: null,
      consumed: 16,
    });
  });

  it('consumes only the header, leaving the stream intact', () => {
    const address = Buffer.alloc(12);
    const trailing = Buffer.from([0x16, 0x03, 0x01]);

    const result = parseProxyProtocol(v2(0x01, 0x11, address, trailing));

    expect(result?.consumed).toBe(16 + 12);
  });

  it('waits for more bytes when the address block is incomplete', () => {
    const partial = v2(0x01, 0x11, Buffer.alloc(12)).subarray(0, 20);

    expect(parseProxyProtocol(partial)).toBeNull();
  });

  it('waits for more bytes when only part of the signature has arrived', () => {
    expect(parseProxyProtocol(V2_SIGNATURE.subarray(0, 6))).toBeNull();
  });

  /**
   * A buffer that starts like the signature and then diverges is not a header
   * that might still complete — it never will, so waiting for more would hang.
   */
  it('rejects a signature that diverges partway', () => {
    const wrong = Buffer.from([0x0d, 0x0a, 0x0d, 0x0a, 0xff]);

    expect(() => parseProxyProtocol(wrong)).toThrow(ProxyProtocolError);
  });

  it('rejects an unsupported version', () => {
    const header = v2(0x01, 0x11, Buffer.alloc(12));
    header[12] = 0x31; // version 3

    expect(() => parseProxyProtocol(header)).toThrow(/version/i);
  });

  /** An address family we cannot read is not an error — just no claim. */
  it('reports no address for an unsupported family', () => {
    expect(
      parseProxyProtocol(v2(0x01, 0x31, Buffer.alloc(12)))?.sourceAddress,
    ).toBeNull();
  });
});

describe('parseProxyProtocol', () => {
  it('waits on an empty buffer', () => {
    expect(parseProxyProtocol(Buffer.alloc(0))).toBeNull();
  });

  /**
   * The security property. With the protocol enabled every connection must
   * carry a header, so one that does not is not the balancer — and a raw TLS
   * handshake reaching this parser means something is talking to the edge
   * directly. Guessing would let it through with a spoofable source address.
   */
  it('refuses a connection that begins with a TLS handshake', () => {
    const clientHello = Buffer.from([0x16, 0x03, 0x01, 0x02, 0x00]);

    expect(() => parseProxyProtocol(clientHello)).toThrow(ProxyProtocolError);
  });

  it('refuses a plain HTTP request', () => {
    expect(() => parseProxyProtocol(Buffer.from('GET / HTTP/1.1\r\n'))).toThrow(
      ProxyProtocolError,
    );
  });
});
