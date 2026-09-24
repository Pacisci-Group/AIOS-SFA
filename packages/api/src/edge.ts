import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import {
  IncomingMessage,
  ServerResponse,
  createServer as createHttpServer,
  request as httpRequest,
} from 'http';
import { Server as NetServer, Socket } from 'net';
import { createServer as createHttpsServer } from 'https';
import { AcmeChallengeService } from './tls/acme-challenge.service';
import { CertificateStoreService } from './tls/certificate-store.service';
import { EdgeRootModule } from './tls/edge-root.module';
import {
  ProxyProtocolError,
  type ProxyProtocolResult,
  looksLikeProxyProtocol,
  parseProxyProtocol,
} from './tls/proxy-protocol';

/**
 * The TLS edge — `dist/edge.js`.
 *
 * Terminates HTTPS for every hostname the platform serves, looking each
 * certificate up by SNI in MongoDB, and proxies to the `web` container.
 *
 * ## What this replaced, and why
 * Caddy did this on the host, holding certificates on local disk and obtaining
 * them on demand behind an `ask` callback. It works well for one server, and
 * that disk is exactly what stops there being a second one: each node would run
 * its own ACME client and race the others for the same hostnames, which
 * Let's Encrypt counts against a duplicate-certificate limit.
 *
 * Reading certificates from a shared database instead is the whole basis of the
 * autoscaling design. A node that joined the pool thirty seconds ago serves a
 * tenant domain added minutes ago, having issued nothing and having no state of
 * its own. Issuance and renewal belong to the worker, deliberately nowhere near
 * a request path.
 *
 * ## Not a Nest HTTP application
 * It boots a Nest *application context* — DI, config and Mongoose, no HTTP
 * stack — and then runs raw `tls` and `http` servers. There are no controllers,
 * no guards and no pipes here, because this process must not have opinions
 * about requests; it terminates TLS and forwards bytes.
 *
 * ## Known limitations, chosen rather than overlooked
 * - **HTTP/1.1 only.** Caddy served HTTP/2 and HTTP/3. Node can do h2 with
 *   ALPN, but proxying it correctly is a materially larger piece of work and
 *   the win at this traffic is small. Worth revisiting; not worth blocking on.
 * - **No OCSP stapling.** Caddy did it automatically.
 * - **No WebSocket upgrades.** The app makes none today. A 501 is returned
 *   rather than a silently hanging socket, so the day one is added the failure
 *   names itself.
 */

/** Paths the edge answers itself, before any proxying or redirect. */
const ACME_PREFIX = '/.well-known/acme-challenge/';
const HEALTH_PATH = '/healthz';

/**
 * How long a connection may take to produce a complete PROXY header.
 *
 * Generous, because it only has to cover one balancer-to-node write; the point
 * is that "never" stops being an option, not to be tight.
 */
const PROXY_HEADER_TIMEOUT_MS = 10_000;

async function bootstrap() {
  const logger = new Logger('Edge');

  const app = await NestFactory.createApplicationContext(EdgeRootModule, {
    // The context is only a service locator here; Nest's own lifecycle logging
    // would say nothing useful on a process with no controllers.
    bufferLogs: false,
  });
  app.enableShutdownHooks();

  const config = app.get(ConfigService);
  const certificates = app.get(CertificateStoreService);
  const challenges = app.get(AcmeChallengeService);

  const upstream = new URL(
    config.get<string>('EDGE_UPSTREAM') ?? 'http://web:80',
  );
  const httpPort = Number(config.get<string>('EDGE_HTTP_PORT') ?? 80);
  const httpsPort = Number(config.get<string>('EDGE_HTTPS_PORT') ?? 443);

  /**
   * A plain listener that NEVER speaks PROXY protocol, for the load balancer's
   * health check.
   *
   * ## Why this port has to exist
   * A DigitalOcean load balancer health-checks a backend by opening its own
   * connection, and that connection does not carry a PROXY header. With
   * EDGE_PROXY_PROTOCOL on, the wrapper below would read the health check's
   * first bytes, find no header, and drop the connection — so every droplet
   * would be marked unhealthy and the pool would receive no traffic at all,
   * while each droplet was in fact serving perfectly.
   *
   * The alternative is a bare TCP health check, which only proves something
   * accepted a socket. This keeps a real HTTP check on a port the firewall
   * admits from the load balancer alone.
   */
  const healthPort = Number(config.get<string>('EDGE_HEALTH_PORT') ?? 8081);

  /**
   * ⚠ Only true behind a balancer that actually sends the header.
   *
   * A PROXY header is a claim about who the peer is. Trusting it from an
   * arbitrary client lets anyone assert any source address and forge or evade
   * rate limiting. Enabling it on the balancer without enabling it here is the
   * mirror failure: the header is read as the first bytes of a TLS handshake
   * and every connection breaks.
   */
  const proxyProtocol =
    config.get<string>('EDGE_PROXY_PROTOCOL')?.trim().toLowerCase() === 'true';

  /**
   * Proxy one request upstream.
   *
   * ⚠ `Host` is forwarded untouched. The API resolves the tenant from it
   * (`HostTenantResolver`), so rewriting it would make every request look like
   * it arrived on one hostname and collapse every tenant into one. This is the
   * same warning the Caddyfile carried in capitals.
   */
  const proxy = (
    req: IncomingMessage,
    res: ServerResponse,
    clientIp: string,
    scheme: 'http' | 'https',
  ): void => {
    const forwardedFor = req.headers['x-forwarded-for'];
    const upstreamReq = httpRequest(
      {
        host: upstream.hostname,
        port: upstream.port || 80,
        method: req.method,
        path: req.url,
        headers: {
          ...req.headers,
          host: req.headers.host ?? '',
          // Appended, not replaced: nginx in the `web` container appends too,
          // and TrustedProxyThrottlerGuard reads the FIRST entry as the client.
          'x-forwarded-for': forwardedFor
            ? `${String(forwardedFor)}, ${clientIp}`
            : clientIp,
          'x-forwarded-proto': scheme,
        },
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );

    upstreamReq.on('error', (error) => {
      logger.warn(
        `Upstream error for ${req.headers.host ?? '?'}: ${error.message}`,
      );
      if (!res.headersSent)
        res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Bad Gateway');
    });

    req.pipe(upstreamReq);
  };

  /**
   * Plain HTTP. Three jobs, in this order — the order is the point.
   *
   * 1. `/healthz`, answered here. It must work before DNS, before a
   *    certificate, and on the bare IP, because it is what the container
   *    healthcheck and (from Phase 4) the load balancer ask.
   * 2. ACME challenges, answered from the database. Never redirected: the CA
   *    speaks plain HTTP and the entire purpose is to answer before a
   *    certificate exists. Never proxied either — nginx's SPA fallback would
   *    return index.html with a 200 and fail the validation while looking fine.
   * 3. Everything else, redirected to HTTPS.
   */
  const httpHandler = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    const url = req.url ?? '/';

    if (url === HEALTH_PATH) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }

    if (url.startsWith(ACME_PREFIX)) {
      // Split on '?' so a query string never becomes part of the token.
      const token = url.slice(ACME_PREFIX.length).split('?')[0];
      const keyAuthorization = await challenges.keyAuthorizationFor(token);

      if (!keyAuthorization) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }

      // Deliberately not logged. The key authorization is the secret half of
      // the exchange, and an access log capturing it would let anyone with log
      // access complete a challenge on our account.
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(keyAuthorization);
      return;
    }

    const host = req.headers.host;
    if (!host) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Bad Request');
      return;
    }

    res.writeHead(301, { Location: `https://${host}${url}` });
    res.end();
  };

  const httpsServer = createHttpsServer({
    /**
     * The lookup that makes a node interchangeable: the certificate comes from
     * the database, keyed by the name the client asked for.
     *
     * A null context refuses the handshake. That is the equivalent of Caddy's
     * `ask` gate saying no — except the decision is made from a row this
     * process already holds, with no second process to be unreachable.
     */
    SNICallback: (servername, callback) => {
      certificates
        .contextFor(servername)
        .then((context) => {
          if (!context) {
            callback(new Error(`No certificate for ${servername}`), undefined);
            return;
          }
          callback(null, context);
        })
        .catch((error: Error) => callback(error, undefined));
    },
  });

  httpsServer.on('request', (req: IncomingMessage, res: ServerResponse) => {
    proxy(req, res, clientIpOf(req.socket), 'https');
  });

  // A TLS handshake failing because we hold no certificate for the name is
  // normal (a scanner, or a domain pointed at us that nobody verified), so it
  // is logged at debug. Without a listener Node would treat it as unhandled.
  httpsServer.on('tlsClientError', (error: Error) => {
    logger.debug(`TLS handshake refused: ${error.message}`);
  });

  const httpServer = createHttpServer(
    (req: IncomingMessage, res: ServerResponse) => {
      void httpHandler(req, res);
    },
  );

  // No WebSocket support. Answering explicitly beats leaving the socket to hang
  // until something times out, which is how a missing feature reads as a
  // network problem.
  for (const server of [httpServer, httpsServer]) {
    server.on('upgrade', (_req, socket: Socket) => {
      socket.end('HTTP/1.1 501 Not Implemented\r\n\r\n');
    });
  }

  /**
   * Health only, and deliberately nothing else — no proxying, no redirect, and
   * never wrapped in the PROXY protocol listener.
   *
   * It answers the same `/healthz` the container health check uses, so "is this
   * droplet fit to receive traffic" has one definition rather than two that can
   * disagree. Anything else 404s: this port is reachable from the load balancer
   * and should not become a second, unauthenticated way into the app.
   */
  const healthServer = createHttpServer(
    (req: IncomingMessage, res: ServerResponse) => {
      if (req.url === HEALTH_PATH) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    },
  );

  if (proxyProtocol) {
    listenWithProxyProtocol(httpServer, httpPort);
    listenWithProxyProtocol(httpsServer, httpsPort);
    logger.log(
      'PROXY protocol is ENABLED: every connection on :80/:443 must carry a header.',
    );
  } else {
    httpServer.listen(httpPort, '0.0.0.0');
    httpsServer.listen(httpsPort, '0.0.0.0');
  }

  // Tolerant of a PROXY header rather than requiring or forbidding one.
  //
  // ⚠ This is the listener the load balancer decides droplet health from, so
  // being wrong here takes the whole pool out of rotation while every droplet
  // serves perfectly — and balancers differ on whether they prefix their own
  // health checks. Accepting both is the only version that cannot be wrong, and
  // it costs a few bytes of sniffing per check.
  listenTolerantOfProxyProtocol(healthServer, healthPort);

  logger.log(
    `Edge listening on :${httpPort} (http), :${httpsPort} (https) and ` +
      `:${healthPort} (health), proxying to ${upstream.origin}`,
  );
}

/**
 * The client address for a connection.
 *
 * Reads the value stashed by the PROXY protocol wrapper when there is one, and
 * falls back to the socket's own peer. Rate limiting downstream depends on
 * this being the real client rather than the balancer.
 */
function clientIpOf(socket: Socket): string {
  const claimed = (socket as Socket & { proxyProtocolSource?: string })
    .proxyProtocolSource;
  return claimed ?? socket.remoteAddress ?? 'unknown';
}

/**
 * Front a server with a listener that accepts connections with OR without a
 * PROXY header.
 *
 * Used only for the health port. Everywhere else the protocol is a contract —
 * either every connection carries a header or none does, and a mismatch is a
 * misconfiguration worth failing loudly on. A health check is the one case where
 * we genuinely do not control, or reliably know, what the other end sends.
 */
function listenTolerantOfProxyProtocol(
  server: { emit: (event: string, socket: Socket) => boolean },
  port: number,
): void {
  const listener = new NetServer((socket: Socket) => {
    let buffered = Buffer.alloc(0);

    const onData = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);

      const verdict = looksLikeProxyProtocol(buffered);
      if (verdict === null) return; // need more bytes to tell

      let consumed = 0;
      if (verdict) {
        let parsed: ProxyProtocolResult | null;
        try {
          parsed = parseProxyProtocol(buffered);
        } catch {
          socket.destroy();
          return;
        }
        if (!parsed) return; // header started but is not complete yet
        consumed = parsed.consumed;
      }

      handOver(socket, server, buffered.subarray(consumed), onData);
    };

    socket.on('data', onData);
    socket.on('error', () => socket.destroy());
  });

  listener.listen(port, '0.0.0.0');
}

/**
 * Hand a socket to the real server, with the bytes after the PROXY header.
 *
 * ⚠ `socket.pause()` and the `resume()` on the next tick are the whole point.
 *
 * `socket.on('data', …)` above put the socket in FLOWING mode, and `unshift()`
 * on a flowing stream does not reliably reach the next consumer. When the
 * client's first payload arrived in the SAME TCP segment as the PROXY header —
 * which is the normal case for a TLS ClientHello behind DigitalOcean's balancer
 * — those bytes were pushed back and then lost. `tls.Server` sat waiting for a
 * ClientHello that never came, and because nothing in this path has a timeout,
 * the connection hung forever without logging anything.
 *
 * It presented as: TCP connects, the ClientHello goes out, and no reply ever
 * arrives. Measured on production, :443 completed roughly 1 connection in 11 —
 * the ones where the header happened to arrive in a segment of its own, so
 * `remainder` was empty and `unshift` was skipped. :80 was unaffected only
 * because an HTTP request usually lands in a later segment.
 *
 * Pausing first, then resuming once the consumer has attached, is the only
 * variant that works for both arrival patterns; `emit`-then-re-emit and
 * `unshift`-then-emit-on-next-tick were both measured and both still hang.
 */
function handOver(
  socket: Socket,
  server: { emit: (event: string, socket: Socket) => boolean },
  remainder: Buffer,
  onData: (chunk: Buffer) => void,
): void {
  socket.removeListener('data', onData);
  socket.pause();
  if (remainder.length > 0) socket.unshift(remainder);
  server.emit('connection', socket);
  process.nextTick(() => socket.resume());
}

/**
 * Front a server with a raw TCP listener that strips the PROXY header first.
 *
 * The header arrives before the TLS handshake, so it cannot be read by the
 * HTTPS server itself. The wrapper consumes it, records the claimed source on
 * the socket, pushes the remaining bytes back, and hands the connection over as
 * if nothing had happened.
 */
function listenWithProxyProtocol(
  server: { emit: (event: string, socket: Socket) => boolean },
  port: number,
): void {
  const logger = new Logger('EdgeProxyProtocol');

  const listener = new NetServer((socket: Socket) => {
    let buffered = Buffer.alloc(0);

    /**
     * ⚠ A connection that never completes a header must not be held forever.
     *
     * Without this, `onData` simply returns while the header is incomplete, so
     * a peer that sends a partial header — or none at all — keeps a socket open
     * indefinitely with nothing logged anywhere. That is not hypothetical: it is
     * how a balancer misconfiguration presented as "TLS hangs" for hours, with
     * no error on either side to point at.
     */
    const headerTimer = setTimeout(() => {
      logger.warn(
        `No complete PROXY header within ${PROXY_HEADER_TIMEOUT_MS}ms from ` +
          `${socket.remoteAddress ?? 'unknown'}; dropping the connection.`,
      );
      socket.destroy();
    }, PROXY_HEADER_TIMEOUT_MS);
    headerTimer.unref();

    const onData = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);

      let parsed: ProxyProtocolResult | null;
      try {
        parsed = parseProxyProtocol(buffered);
      } catch (error) {
        // A connection that does not speak the protocol we were told every
        // connection speaks is not one to guess about.
        logger.warn(
          error instanceof ProxyProtocolError ? error.message : String(error),
        );
        clearTimeout(headerTimer);
        socket.destroy();
        return;
      }

      // Header not complete yet; wait for more bytes.
      if (!parsed) return;

      clearTimeout(headerTimer);
      if (parsed.sourceAddress) {
        (
          socket as Socket & { proxyProtocolSource?: string }
        ).proxyProtocolSource = parsed.sourceAddress;
      }

      // Everything after the header goes back on the stream, so the TLS/HTTP
      // server sees one that begins exactly where it expects to.
      handOver(socket, server, buffered.subarray(parsed.consumed), onData);
    };

    socket.on('data', onData);
    socket.on('error', () => {
      clearTimeout(headerTimer);
      socket.destroy();
    });
  });

  listener.listen(port, '0.0.0.0');
}

void bootstrap();
