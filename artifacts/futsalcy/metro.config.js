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
    // Metro sends raw Hermes bytecode (~13 MB) with no compression.
    // Over the serveo SSH tunnel this takes 50-100 s and often drops.
    // JS/bytecode gzips to ~25% of its original size (~3 MB), making the
    // download 4-5× faster and reliable enough for Expo Go on Android.
    const acceptsGzip = (req.headers["accept-encoding"] || "").includes("gzip");
    if (acceptsGzip && req.url && req.url.includes(".bundle")) {
      const chunks = [];
      const _end = res.end.bind(res);
      const _write = res.write.bind(res);

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
        const body = Buffer.concat(chunks);
        zlib.gzip(body, { level: 6 }, (err, compressed) => {
          if (err) {
            // Fallback: send uncompressed if gzip fails
            console.warn("[metro-gzip] compression failed, sending raw:", err.message);
            _end(body);
          } else {
            res.removeHeader("Content-Length");
            res.setHeader("Content-Encoding", "gzip");
            res.setHeader("Content-Length", String(compressed.length));
            _end(compressed);
          }
        });
      };
    }

    middleware(req, res, next);
  };
};

module.exports = config;
