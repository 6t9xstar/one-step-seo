import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { fetchWithRedirects, fetchText, safePinnedFetch } from "../lib/fetch.mjs";

/** @type {import("node:http").Server | null} */
let server = null;
/** @type {string} */
let base = "";

const BIG = "x".repeat(6 * 1024 * 1024);

before(
  () =>
    /** @type {Promise<void>} */ (
      new Promise((resolve) => {
        server = http.createServer((req, res) => {
          if (req.url === "/final") {
            res.writeHead(200, { "content-type": "text/html" });
            res.end("<html><head><title>t</title></head><body>ok</body></html>");
          } else if (req.url === "/a") {
            res.writeHead(301, { location: "/b" });
            res.end();
          } else if (req.url === "/b") {
            res.writeHead(302, { location: "/final" });
            res.end();
          } else if (req.url === "/loop") {
            res.writeHead(301, { location: "/loop" });
            res.end();
          } else if (req.url === "/slow") {
            setTimeout(() => {
              res.writeHead(200, { "content-type": "text/html" });
              res.end("late");
            }, 500);
          } else if (req.url === "/big") {
            res.writeHead(200, { "content-type": "text/html" });
            res.end(`<html><head><title>big</title></head><body>${BIG}</body></html>`);
          } else if (req.url === "/missing") {
            res.writeHead(404, { "content-type": "text/html" });
            res.end("nope");
          } else if (req.url === "/robots.txt") {
            res.writeHead(200, { "content-type": "text/plain" });
            res.end("User-agent: *\nDisallow:\n");
          } else {
            res.writeHead(500);
            res.end();
          }
        });
        server.listen(0, "127.0.0.1", () => {
          const addr = server?.address();
          base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
          resolve();
        });
      })
    ),
);

after(
  () =>
    /** @type {Promise<void>} */ (
      new Promise((resolve) => {
        if (server) {
          server.closeAllConnections?.();
          server.close(() => resolve());
        } else resolve();
      })
    ),
);

test("follows a redirect chain and records each step", async () => {
  const r = await fetchWithRedirects(`${base}/a`, { timeoutMs: 5000 });
  assert.equal(r.ok, true);
  assert.equal(r.status, 200);
  assert.deepEqual(
    r.statusChain.map((s) => s.status),
    [301, 302, 200],
  );
  assert.ok(r.html.includes("ok"));
  assert.equal(r.truncated, false);
});

test("gives up after too many redirects", async () => {
  const r = await fetchWithRedirects(`${base}/loop`, { timeoutMs: 5000 });
  assert.equal(r.ok, false);
  assert.match(r.error, /too many redirects/);
  assert.equal(r.statusChain.length, 6);
});

test("times out a slow server", async () => {
  const r = await fetchWithRedirects(`${base}/slow`, { timeoutMs: 100 });
  assert.equal(r.ok, false);
  assert.match(r.error, /timeout/);
});

test("caps oversized bodies and flags truncation", async () => {
  const r = await fetchWithRedirects(`${base}/big`, { timeoutMs: 10000 });
  assert.equal(r.ok, true);
  assert.equal(r.truncated, true);
  assert.ok(r.html.length <= 5 * 1024 * 1024 + 1024);
  assert.ok(r.html.includes("<title>big</title>"));
});

test("non-200 surfaces status without html", async () => {
  const r = await fetchWithRedirects(`${base}/missing`, { timeoutMs: 5000 });
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
  assert.equal(r.html, "");
});

test("times out a server that stalls mid-body", async () => {
  // Headers arrive, then the body is drip-fed and never ended. A headers-only
  // deadline clears the abort timer as soon as fetch() resolves, so this used
  // to hang the caller indefinitely.
  const drip = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.write("<html><body>partial");
    // deliberately never end()s
  });
  await new Promise((resolve) => drip.listen(0, "127.0.0.1", () => resolve(undefined)));
  const port = /** @type {import("node:net").AddressInfo} */ (drip.address())?.port;
  try {
    const started = Date.now();
    const r = await fetchWithRedirects(`http://127.0.0.1:${port}/`, { timeoutMs: 1000 });
    const elapsed = Date.now() - started;
    assert.equal(r.ok, false);
    assert.match(r.error, /timeout/);
    // Must fail near the deadline rather than hanging on the open socket.
    assert.ok(elapsed < 5000, `expected a fast timeout, took ${elapsed}ms`);
  } finally {
    drip.closeAllConnections?.();
    await new Promise((r) => drip.close(r));
  }
});

test("fetchText fetches small files best-effort", async () => {
  const ok = await fetchText(`${base}/robots.txt`);
  assert.equal(ok.ok, true);
  assert.ok(ok.text.includes("User-agent"));
  const bad = await fetchText(`${base}/nope.txt`);
  assert.equal(bad.ok, false);
});

test("fetchWithRedirects times out on slow headers", async () => {
  const slowHdr = http.createServer((_req, _res) => {
    // Deliberately delay sending response headers
  });
  await new Promise((resolve) => slowHdr.listen(0, "127.0.0.1", () => resolve(undefined)));
  const port = /** @type {import("node:net").AddressInfo} */ (slowHdr.address())?.port;
  try {
    const started = Date.now();
    const r = await fetchWithRedirects(`http://127.0.0.1:${port}/`, { timeoutMs: 500 });
    const elapsed = Date.now() - started;
    assert.equal(r.ok, false);
    assert.match(r.error, /timeout/);
    assert.ok(elapsed < 4000, `expected timeout near 500ms, took ${elapsed}ms`);
  } finally {
    slowHdr.closeAllConnections?.();
    await new Promise((r) => slowHdr.close(r));
  }
});

test("fetchText times out a server that stalls mid-body", async () => {
  const drip = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.write("User-agent: *\n");
    // deliberately never end()s
  });
  await new Promise((resolve) => drip.listen(0, "127.0.0.1", () => resolve(undefined)));
  const port = /** @type {import("node:net").AddressInfo} */ (drip.address())?.port;
  try {
    const started = Date.now();
    const r = await fetchText(`http://127.0.0.1:${port}/robots.txt`, { timeoutMs: 500 });
    const elapsed = Date.now() - started;
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /timeout/);
    assert.ok(elapsed < 4000, `expected timeout near 500ms, took ${elapsed}ms`);
  } finally {
    drip.closeAllConnections?.();
    await new Promise((r) => drip.close(r));
  }
});

test("fetchText times out on slow headers", async () => {
  const slowHdr = http.createServer((_req, _res) => {
    // Deliberately delay headers
  });
  await new Promise((resolve) => slowHdr.listen(0, "127.0.0.1", () => resolve(undefined)));
  const port = /** @type {import("node:net").AddressInfo} */ (slowHdr.address())?.port;
  try {
    const started = Date.now();
    const r = await fetchText(`http://127.0.0.1:${port}/robots.txt`, { timeoutMs: 500 });
    const elapsed = Date.now() - started;
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /timeout/);
    assert.ok(elapsed < 4000, `expected timeout near 500ms, took ${elapsed}ms`);
  } finally {
    slowHdr.closeAllConnections?.();
    await new Promise((r) => slowHdr.close(r));
  }
});

test("fetchWithRedirects and fetchText reject non-http/https protocols", async () => {
  const r1 = await fetchWithRedirects("file:///etc/passwd");
  assert.equal(r1.ok, false);
  assert.match(r1.error, /blocked protocol/);

  const r2 = await fetchText("ftp://example.com/robots.txt");
  assert.equal(r2.ok, false);
  assert.match(r2.error ?? "", /blocked protocol/);
});

test("fetchText handles redirects and enforces SSRF boundaries on redirect hops", async () => {
  const redirectServer = http.createServer((req, res) => {
    if (req.url === "/r1") {
      res.writeHead(302, { location: "/r2" });
      res.end();
    } else if (req.url === "/r2") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("User-agent: *\nAllow: /");
    } else if (req.url === "/evil-redirect") {
      res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" });
      res.end();
    }
  });
  await new Promise((resolve) => redirectServer.listen(0, "127.0.0.1", () => resolve(undefined)));
  const port = /** @type {import("node:net").AddressInfo} */ (redirectServer.address())?.port;
  try {
    const ok = await fetchText(`http://127.0.0.1:${port}/r1`);
    assert.equal(ok.ok, true);
    assert.ok(ok.text.includes("Allow: /"));
    assert.equal(ok.finalUrl, `http://127.0.0.1:${port}/r2`);

    const evil = await fetchText(`http://127.0.0.1:${port}/evil-redirect`);
    assert.equal(evil.ok, false);
    assert.match(evil.error ?? "", /cloud metadata/);
  } finally {
    redirectServer.closeAllConnections?.();
    await new Promise((r) => redirectServer.close(r));
  }
});

test("fetchWithRedirects blocks redirects to private addresses and cloud metadata", async () => {
  const srv = http.createServer((req, res) => {
    if (req.url === "/meta") {
      res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" });
      res.end();
    } else if (req.url === "/priv") {
      res.writeHead(302, { location: "http://10.0.0.1/admin" });
      res.end();
    }
  });
  await new Promise((resolve) => srv.listen(0, "127.0.0.1", () => resolve(undefined)));
  const port = /** @type {import("node:net").AddressInfo} */ (srv.address())?.port;
  try {
    const metaRes = await fetchWithRedirects(`http://127.0.0.1:${port}/meta`);
    assert.equal(metaRes.ok, false);
    assert.match(metaRes.error, /cloud metadata endpoint/);

    const privRes = await fetchWithRedirects(`http://127.0.0.1:${port}/priv`, { blockPrivateIps: true });
    assert.equal(privRes.ok, false);
    assert.match(privRes.error, /private\/internal/);
  } finally {
    srv.closeAllConnections?.();
    await new Promise((r) => srv.close(r));
  }
});

test("safePinnedFetch enforces socket-level DNS pinning and prevents requests reaching rebound private IP", async () => {
  let internalReceived = false;
  const internalServer = http.createServer((req, res) => {
    internalReceived = true;
    res.writeHead(200);
    res.end("INTERNAL_SECRET_LEAK");
  });
  await new Promise((resolve) => internalServer.listen(0, "127.0.0.1", () => resolve(undefined)));
  const port = /** @type {import("node:net").AddressInfo} */ (internalServer.address())?.port;

  try {
    // 1. Direct IP with blockPrivateIps rejects before connection
    await assert.rejects(
      safePinnedFetch(`http://127.0.0.1:${port}/secret`, { blockPrivateIps: true }),
      /private\/internal network address/,
    );
    assert.equal(internalReceived, false, "Internal service must not receive connection on blocked IP");

    // 2. Localhost hostname with blockPrivateIps rejects before connection
    await assert.rejects(
      safePinnedFetch(`http://localhost:${port}/secret`, { blockPrivateIps: true }),
      /private\/internal network address/,
    );
    assert.equal(internalReceived, false, "Internal service must not receive connection on localhost");

    // 3. fetchWithRedirects with blockPrivateIps rejects before connection
    const r = await fetchWithRedirects(`http://127.0.0.1:${port}/secret`, { blockPrivateIps: true });
    assert.equal(r.ok, false);
    assert.match(r.error, /private\/internal network address/);
    assert.equal(internalReceived, false, "Internal service must not receive request via fetchWithRedirects");
  } finally {
    internalServer.closeAllConnections?.();
    await new Promise((r) => internalServer.close(r));
  }
});
