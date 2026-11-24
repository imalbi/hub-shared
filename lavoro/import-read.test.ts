import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { parseHTML } from 'linkedom';
import { fetchPage, parsePostingFromHtml } from './import-read.ts';
import { isPrivateOrLoopbackIp } from './public-host.ts';

void test('BlockList refuses IPv4-mapped, IPv4-compatible, NAT64, 6to4 and site-local IPv6 literals', () => {
  const privateIps = [
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:192.168.1.1', // guard-private: allow Synthetic security test value
    '::127.0.0.1',
    '::7f00:1',
    '64:ff9b::7f00:1',
    '::ffff:0:7f00:1',
    '2002:7f00:1::',
    'fec0::1',
    'fc00::1', // guard-private: allow Synthetic security test value
    'fe80::1', // guard-private: allow Synthetic security test value
    '100.64.0.1', // guard-private: allow Synthetic security test value
    '127.0.0.1',
  ];
  for (const ip of privateIps) {
    assert.equal(isPrivateOrLoopbackIp(ip), true, ip);
  }
  assert.equal(isPrivateOrLoopbackIp('93.184.216.34'), false);
  assert.equal(isPrivateOrLoopbackIp('2606:2800:220:1:248:1893:25c8:1946'), false);
});

void test('fetchPage refuses obfuscated IPv6 private URLs before any network request', async () => {
  const refused = [
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:192.168.1.1]/', // guard-private: allow Synthetic security test value
    'http://[::127.0.0.1]/',
    'http://[64:ff9b::7f00:1]/',
    'http://[::ffff:0:7f00:1]/',
    'http://[2002:7f00:1::]/',
    'http://[fec0::1]/',
  ];
  for (const url of refused) {
    await assert.rejects(fetchPage(url, { timeoutMs: 250 }), { message: /refused/i });
  }
});

void test('fetchPage pins checked public IP and never connects to a rebinding private IP on a second lookup', async (t) => {
  let privateServerHits = 0;
  const server = http.createServer((_req, res) => {
    privateServerHits++;
    res.writeHead(200);
    res.end('secret');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const address = server.address();
  assert.ok(address && typeof address === 'object');

  let lookupCalls = 0;
  // TEST-NET-2 IP (198.51.100.x) is reserved/blocked, so use a public non-routable carrier IP that fails connection
  // or connect to a public-IP local sink; here we assert the private 127.0.0.1 returned on call 2 is never queried.
  // Note: 93.184.216.34 is public; if firewall drops port, timeout triggers cleanly in 150ms without hitting 127.0.0.1.
  const lookup = () => {
    lookupCalls++;
    return lookupCalls === 1 ? ['93.184.216.34'] : ['127.0.0.1'];
  };

  await assert.rejects(fetchPage(`http://rebind.example:${address.port}/job`, { lookup, timeoutMs: 150 }));
  assert.equal(lookupCalls, 1);
  assert.equal(privateServerHits, 0);
});

void test('parsePostingFromHtml ignores non-http canonical and directApply URLs', () => {
  const doc = parseHTML('<html><body></body></html>').document;
  const html = `
    <html>
      <head>
        <link rel="canonical" href="javascript:alert(1)" />
        <script type="application/ld+json">
          { "@type": "JobPosting", "title": "Dev", "directApply": "javascript:alert(2)" }
        </script>
      </head>
      <body></body>
    </html>
  `;
  const parsed = parsePostingFromHtml(html, 'https://example.org/job/1', doc);
  assert.equal(parsed.url, 'https://example.org/job/1');
  assert.equal(parsed.applyUrl, null);
});
