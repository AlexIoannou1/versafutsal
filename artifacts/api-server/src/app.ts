import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "node:path";
import fs from "node:fs";
import router from "./routes";
import { logger } from "./lib/logger";
import { requestParseError, requestValidation } from "./middlewares/request-validation";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const app: Express = express();

// Serve local uploads (venue photos, etc.) — no auth required, public marketing content
app.use("/api/uploads", express.static(UPLOADS_DIR));

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
app.use(express.json({ limit: "100kb", strict: true }));
app.use(express.urlencoded({ extended: false, limit: "32kb", parameterLimit: 50 }));
app.use(requestValidation);

app.use("/api", router);
app.use(requestParseError);

export default app;
