const { getDefaultConfig } = require("expo/metro-config");
const http = require("http");
const zlib = require("zlib");

const config = getDefaultConfig(__dirname);

// Lazy-load modules: only evaluate code for the first screen on startup,
// then load the rest on demand. Reduces initial parse/eval time and avoids
// pulling in heavy native modules (e.g. Stripe) before they are needed.
config.transformer = config.transformer || {};
config.transformer.inlineRequires = true;

config.server = config.server || {};
config.server.enhanceMiddleware = (middleware) => {
  return (req, res, next) => {
    // ── API proxy ────────────────────────────────────────────────────────
    // Expo web and native both call /api/... which gets forwarded to the
    // API server on port 8080. This avoids cross-origin issues and keeps
    // a single base URL for all client code.
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
    // Metro serves raw Hermes bytecode (~13 MB) with no compression even
    // though it sets Vary: Accept-Encoding. When Expo Go downloads the
    // bundle via the public Replit HTTPS endpoint, OkHttp sends
    // Accept-Encoding: gzip and we compress the response here.
    //
    // Implementation notes:
    //  - Use gzipSync (not async) to avoid a gap where Metro/Node could
    //    flush headers early before we can update Content-Length.
    //  - Intercept res.writeHead to suppress the early header flush;
    //    restore it before calling the original res.end.
    const acceptsGzip = (req.headers["accept-encoding"] || "").includes("gzip");
    if (acceptsGzip && req.url && req.url.includes(".bundle")) {
      const chunks = [];
      const _end = res.end.bind(res);
      const _writeHead = res.writeHead.bind(res);

      // Suppress early header flush — capture Metro's headers for later use
      res.writeHead = function (statusCode, rawHeaders) {
        res.statusCode = statusCode;
        // Preserve all headers Metro sets except Content-Length/Content-Encoding
        // (those are replaced by our gzip versions)
        if (rawHeaders && typeof rawHeaders === "object") {
          Object.entries(rawHeaders).forEach(([key, val]) => {
            const lk = key.toLowerCase();
            if (lk !== "content-length" && lk !== "content-encoding") {
              try { res.setHeader(key, val); } catch (_) {}
            }
          });
        }
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
          console.warn("[metro-gzip] compression failed, sending raw:", err.message);
          _end(body);
        }
      };
    }

    middleware(req, res, next);
  };
};

module.exports = config;
