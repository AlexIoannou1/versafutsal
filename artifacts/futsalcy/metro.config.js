const { getDefaultConfig } = require("expo/metro-config");
const http = require("http");

const config = getDefaultConfig(__dirname);

// Lazy-load modules: only bundle code for the first screen on startup,
// then load the rest on demand. Dramatically reduces initial bundle size
// and fixes "stuck on bundling" over slow/tunnelled connections.
config.transformer = config.transformer || {};
config.transformer.inlineRequires = true;

config.server = config.server || {};
config.server.enhanceMiddleware = (middleware) => {
  return (req, res, next) => {
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
    middleware(req, res, next);
  };
};

module.exports = config;
