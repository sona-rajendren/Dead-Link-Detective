import http from 'node:http';

/**
 * A tiny local web site that misbehaves on purpose.
 * Used by the automated tests and by `npm run demo`, so everything can be
 * demonstrated without internet access and with predictable results.
 */
export const DEMO_PATHS = [
  '/', '/about', '/docs', '/pricing',
  '/old-page', '/moved-temp', '/old-chain', '/loop-a',
  '/missing', '/gone', '/forbidden', '/server-error',
  '/slow', '/very-slow', '/timeout', '/head-not-allowed', '/flaky',
];

export async function startMockServer(port = 0) {
  const hits = new Map();
  const count = (key) => {
    hits.set(key, (hits.get(key) ?? 0) + 1);
    return hits.get(key);
  };

  const send = (res, status, body = '', headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
    res.end(body);
  };

  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    switch (pathname) {
      case '/': case '/about': case '/docs': case '/pricing': case '/ok': case '/new-page':
        return send(res, 200, 'OK');
      case '/old-page': return send(res, 301, '', { Location: '/new-page' });
      case '/moved-temp': return send(res, 302, '', { Location: '/ok' });
      case '/old-chain': return send(res, 301, '', { Location: '/chain-2' });
      case '/chain-2': return send(res, 302, '', { Location: '/chain-3' });
      case '/chain-3': return send(res, 307, '', { Location: '/ok' });
      case '/loop-a': return send(res, 302, '', { Location: '/loop-b' });
      case '/loop-b': return send(res, 302, '', { Location: '/loop-a' });
      case '/missing': return send(res, 404, 'Not Found');
      case '/gone': return send(res, 410, 'Gone');
      case '/forbidden': return send(res, 403, 'Forbidden');
      case '/server-error': return send(res, 500, 'Boom');
      case '/slow': return void setTimeout(() => send(res, 200, 'slow'), 1800);
      case '/very-slow': return void setTimeout(() => send(res, 200, 'very slow'), 2600);
      case '/timeout': return; // never answers
      case '/head-not-allowed':
        return req.method === 'HEAD' ? send(res, 405, '', { Allow: 'GET' }) : send(res, 200, 'GET works');
      case '/flaky': // first attempt (HEAD + GET) gets 503, the retry succeeds
        return count('flaky') <= 2 ? send(res, 503, 'try again') : send(res, 200, 'recovered');
      case '/reset': return void req.socket.destroy();
      default: return send(res, 404, 'Not Found');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const { port: actual } = server.address();

  return {
    server,
    port: actual,
    baseUrl: `http://127.0.0.1:${actual}`,
    hits,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(resolve);
      }),
  };
}
