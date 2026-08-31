import { requestSchemas } from "@workspace/api-zod";

type RequestParser = {
  safeParse(value: unknown): {
    success: boolean;
    data?: unknown;
    error?: { issues: Array<{ path: Array<string | number>; code?: string; message?: string }> };
  };
};

export type ValidationIssue = {
  field: string;
  code: "required" | "invalid" | "too_long" | "unsafe";
};

export type ValidationResult<T = unknown> =
  | { success: true; data: T; issues: [] }
  | { success: false; data: undefined; issues: ValidationIssue[] };

function routeMatches(template: string, pathname: string): boolean {
  const pattern = template
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/:([A-Za-z0-9_]+)/g, "[^/]+");
  return new RegExp(`^${pattern}$`).test(pathname);
}

function schemaFor(method: string, pathname: string) {
  const normalizedPath = pathname.replace(/^\/api(?=\/|$)/, "") || "/";
  const entry = Object.keys(requestSchemas).find((key) => {
    const [schemaMethod, template] = key.split(" ");
    return schemaMethod === method.toUpperCase() && routeMatches(template!, normalizedPath);
  });
  return (entry ? requestSchemas[entry as keyof typeof requestSchemas] : undefined) as
    | { body?: RequestParser }
    | undefined;
}

function issueCode(issue: { code?: string; message?: string }): ValidationIssue["code"] {
  if (issue.code === "too_big") return "too_long";
  if (issue.code === "too_small" && issue.message?.toLowerCase().includes("required")) return "required";
  if (issue.message?.toLowerCase().includes("unsafe")) return "unsafe";
  return "invalid";
}

/**
 * Validate a JSON request on the client before it is sent. This deliberately
 * returns stable, localization-ready issue codes rather than Zod messages.
 * The API server repeats the validation and remains authoritative.
 */
export function validateRequestBody<T = unknown>(
  method: string,
  pathname: string,
  value: unknown,
): ValidationResult<T> {
  const schema = schemaFor(method, pathname);
  if (!schema?.body) return { success: true, data: value as T, issues: [] };

  const parsed = schema.body.safeParse(value);
  if (parsed.success) return { success: true, data: parsed.data as T, issues: [] };

  const issues: ValidationIssue[] = (parsed.error?.issues ?? []).map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join(".") : "form",
    code: issueCode(issue),
  }));
  return { success: false, data: undefined, issues };
}

export function validationMessage(issue: ValidationIssue): string {
  const field = issue.field === "form" ? "This form" : issue.field;
  switch (issue.code) {
    case "required":
      return `${field} is required.`;
    case "too_long":
      return `${field} is too long.`;
    case "unsafe":
      return `${field} contains unsupported characters.`;
    default:
      return `${field} is invalid.`;
  }
}
