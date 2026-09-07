import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "node:path";
import router from "./routes";
import { logger } from "./lib/logger";
import { requestParseError, requestValidation } from "./middlewares/request-validation";

const app: Express = express();

// Profile avatars predate venue object storage and still use this public path.
// Venue photos are served from private object storage by the venue-photo route.
app.use("/api/uploads/venue-photos", (_req, res) => {
  res.status(404).end();
});
app.use("/api/uploads", express.static(path.join(process.cwd(), "uploads")));

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({
  limit: "100kb",
  strict: true,
  verify(req, _res, buffer) {
    (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
  },
}));
app.use(express.urlencoded({ extended: false, limit: "32kb", parameterLimit: 50 }));
app.use(requestValidation);

app.use("/api", router);
app.use(requestParseError);

export default app;
