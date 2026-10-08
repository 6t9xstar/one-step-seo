import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { fetchWithRedirects, fetchText } from "../lib/fetch.mjs";

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
        if (server) server.close(() => resolve());
        else resolve();
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

test("fetchText fetches small files best-effort", async () => {
  const ok = await fetchText(`${base}/robots.txt`);
  assert.equal(ok.ok, true);
  assert.ok(ok.text.includes("User-agent"));
  const bad = await fetchText(`${base}/nope.txt`);
  assert.equal(bad.ok, false);
});
