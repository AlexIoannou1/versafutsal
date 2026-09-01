import type { NextFunction, Request, Response } from "express";
import { normalizePhoneNumber, requestSchemas, uuid } from "@workspace/api-zod";

type Location = "body" | "params" | "query";
type Parser = { safeParse(value: unknown): { success: boolean; data?: any } };
type SchemaSet = { body?: Parser; params?: Parser; query?: Parser };

const routeTemplates = [
  ...Object.keys(requestSchemas),
  "GET /auth/me", "DELETE /player/account", "GET /player/payment-methods", "GET /player/payment-methods/config",
  "POST /player/payment-methods/setup-intent", "DELETE /player/payment-methods/:pmId",
  "GET /player/notifications", "GET /owner/notifications", "GET /owner/stats",
  "GET /venues/:id", "GET /owner/venues", "GET /owner/venues/:id", "DELETE /owner/venues/:id",
  "POST /owner/venues/:id/submit", "POST /owner/venues/:id/photos/upload",
  "DELETE /owner/venues/:venueId/photos/:photoId", "DELETE /owner/venues/:id/pitches/:pitchId",
  "GET /owner/venues/:venueId/blocks", "DELETE /owner/venues/:venueId/blocks/:blockId",
  "GET /player/bookings/:id", "GET /owner/bookings/:id", "GET /owner/bookings/:id/audit",
  "GET /admin/venues/:id", "PUT /admin/venues/:id/approve", "GET /admin/bookings/:id",
  "GET /admin/bookings/:id/audit", "GET /admin/settings", "GET /bookings/:bookingId/payment",
  "DELETE /owner/venues/:venueId/pitches/:pitchId/blocks/:blockId", "DELETE /auth/push-token",
  "DELETE /owner/connect/account", "DELETE /owner/account", "GET /owner/connect/config",
  "POST /owner/connect/account", "POST /owner/connect/onboarding-link", "GET /owner/connect/status",
  "GET /player/favourites", "GET /player/favourites/ids", "POST /player/favourites/:venueId",
  "DELETE /player/favourites/:venueId", "POST /player/avatar", "GET /healthz",
];

const compiled = routeTemplates.map((entry) => {
  const [method, template] = entry.split(" ") as [string, string];
  const names: string[] = [];
  const pattern = template.replace(/:([A-Za-z0-9_]+)/g, (_part, name) => {
    names.push(name);
    return "([^/]+)";
  });
  return { entry, method, names, regex: new RegExp(`^${pattern}$`) };
});

function invalid(res: Response, location: Location, field?: string) {
  // Deliberately do not disclose fields, payloads, parser details, or Zod errors.
  res.status(400).json({
    error: "Invalid request input",
    code: `REQUEST_${location.toUpperCase()}_INVALID`,
    ...(field ? { field } : {}),
  });
}

function invalidBodyField(req: Request): string | undefined {
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const input = body as Record<string, unknown>;
  const pathname = req.path.startsWith("/api/") ? req.path.slice(4) : req.path;

  if (pathname === "/auth/register") {
    if (typeof input.name !== "string" || !input.name.trim()) return "name";
    if (typeof input.email !== "string" || !input.email.trim()) return "email";
    if (typeof input.password !== "string" || !input.password) return "password";
    if (typeof input.phoneNumber !== "string" || !input.phoneNumber.trim()) return "phoneNumber";
    try {
      normalizePhoneNumber(input.phoneNumber);
    } catch {
      return "phoneNumber";
    }
  }

  if (pathname === "/auth/profile" && input.phoneNumber !== undefined) {
    try {
      if (typeof input.phoneNumber !== "string") throw new Error("invalid");
      normalizePhoneNumber(input.phoneNumber);
    } catch {
      return "phoneNumber";
    }
  }

  return undefined;
}

export function requestValidation(req: Request, res: Response, next: NextFunction) {
  const pathname = req.path.startsWith("/api/") ? req.path.slice(4) : req.path;
  const route = compiled.find((candidate) => candidate.method === req.method && candidate.regex.test(pathname));
  if (!route) return next();

  const match = route.regex.exec(pathname);
  const fallbackParams: Record<string, string> = {};
  route.names.forEach((name, index) => { fallbackParams[name] = match?.[index + 1] ?? ""; });
  const schema = (requestSchemas as Record<string, SchemaSet>)[route.entry];

  // The app-level matcher runs before Express populates req.params.
  const parsedParams = (schema?.params ?? {
    safeParse(input: Record<string, string>) {
      for (const [name, paramValue] of Object.entries(input)) {
        if (name === "pmId" ? !/^pm_[A-Za-z0-9_]{1,251}$/.test(paramValue) : !uuid.safeParse(paramValue).success) {
          return { success: false };
        }
      }
      return { success: true, data: input };
    },
  }).safeParse(fallbackParams);
  if (!parsedParams.success) return invalid(res, "params");
  req.params = parsedParams.data;

  const parsedQuery = (schema?.query ?? strictEmpty).safeParse(req.query);
  if (!parsedQuery.success) return invalid(res, "query");
  Object.assign(req.query as Record<string, unknown>, parsedQuery.data);

  // Multer owns multipart parsing. Its body is intentionally not touched, while URL params/query remain protected.
  if (req.is("multipart/*")) return next();
  if (!["GET", "HEAD"].includes(req.method)) {
    const bodySchema = schema?.body ?? strictEmpty;
    const parsedBody = bodySchema.safeParse(req.body ?? {});
    if (!parsedBody.success) return invalid(res, "body", invalidBodyField(req));
    req.body = parsedBody.data;
  }
  return next();
}

const strictEmpty: Parser = {
  safeParse(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0
      ? { success: true, data: {} }
      : { success: false };
  },
};

/** Converts parser failures to the same bounded public error contract. */
export function requestParseError(err: unknown, _req: Request, res: Response, next: NextFunction) {
  if (
    err &&
    typeof err === "object" &&
    "status" in err &&
    [400, 413].includes((err as { status?: number }).status ?? 0)
  ) {
    return invalid(res, "body");
  }
  return next(err);
}