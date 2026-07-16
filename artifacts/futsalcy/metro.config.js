const { getDefaultConfig } = require("expo/metro-config");
const http = require("http");
const zlib = require("zlib");

const config = getDefaultConfig(__dirname);

// Lazy-load modules: only bundle code for the first screen on startup,
// then load the rest on demand. Dramatically reduces initial bundle size
// and fixes "stuck on bundling" over slow/tunnelled connections.
config.transformer = config.transformer || {};
config.transformer.inlineRequires = true;

config.server = config.server || {};
config.server.enhanceMiddleware = (middleware) => {
  return (req, res, next) => {
    // ── API proxy ────────────────────────────────────────────────────────
    if (req.url && req.url.startsWith("/api")) {
      const options = {
        hostname: "localhost",
        port: 8080,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: "localhost:8080" },
      };

      const proxy = http.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
      });

      proxy.on("error", (err) => {
        console.error("[metro-api-proxy] error:", err.message);
        res.writeHead(502);
        res.end("API proxy error");
      });

      req.pipe(proxy, { end: true });
      return;
    }

    // ── Gzip compression for bundle downloads ────────────────────────────
    // Metro sends raw Hermes bytecode (~13 MB) with no compression even
    // though it sets Vary: Accept-Encoding. Over the serveo SSH tunnel
    // this takes 50-100 s and often drops, causing Expo Go on Android to
    // hang forever on "Loading from …serveousercontent.com".
    //
    // OkHttp (used by Expo Go) sends Accept-Encoding: gzip on every request
    // and decompresses transparently, so no Expo Go changes are needed.
    //
    // Implementation notes:
    //  - Use gzipSync (not async) so there is no gap between buffering and
    //    sending in which Metro/Node could flush headers early.
    //  - Intercept res.writeHead as well to prevent Metro from committing
    //    headers (including Content-Length) before we can replace them.
    const acceptsGzip = (req.headers["accept-encoding"] || "").includes("gzip");
    if (acceptsGzip && req.url && req.url.includes(".bundle")) {
      const chunks = [];
      const _end = res.end.bind(res);
      const _writeHead = res.writeHead.bind(res);

      // Suppress early header flush — we will call _writeHead from res.end
      res.writeHead = function (statusCode) {
        res.statusCode = statusCode;
        // intentionally a no-op until our res.end wrapper runs
      };

      res.write = function (chunk, encoding, cb) {
        if (chunk) {
          chunks.push(
            Buffer.isBuffer(chunk)
              ? chunk
              : Buffer.from(chunk, typeof encoding === "string" ? encoding : "utf8")
          );
        }
        if (typeof encoding === "function") encoding();
        else if (typeof cb === "function") cb();
        return true;
      };

      res.end = function (chunk, encoding, cb) {
        if (chunk && typeof chunk !== "function") {
          chunks.push(
            Buffer.isBuffer(chunk)
              ? chunk
              : Buffer.from(chunk, typeof encoding === "string" ? encoding : "utf8")
          );
        }

        // Restore writeHead so _end can flush headers normally
        res.writeHead = _writeHead;

        const body = Buffer.concat(chunks);
        try {
          const compressed = zlib.gzipSync(body, { level: 6 });
          res.removeHeader("Content-Length");
          res.setHeader("Content-Encoding", "gzip");
          res.setHeader("Content-Length", String(compressed.length));
          _end(compressed);
        } catch (err) {
          // Fallback: send uncompressed if gzip fails
          console.warn("[metro-gzip] compression failed, sending raw:", err.message);
          _end(body);
        }
      };
    }

    middleware(req, res, next);
  };
};

module.exports = config;
