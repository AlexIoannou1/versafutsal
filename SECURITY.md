# FutsalCY input security boundary

All user-controlled request data follows the same boundary:

1. **Validate at the API edge.** `@workspace/api-zod` contains the hand-authored
   runtime policies. The Express request-validation middleware checks route
   parameters, query filters, and JSON bodies before route code or database
   access. JSON and URL-encoded parsers have bounded sizes and reject malformed
   input. Multipart image requests still validate their URL parameters before
   the upload parser handles file bytes.
2. **Canonicalize plain text, never secrets.** Names, addresses, labels,
   descriptions, reasons, and searches are trimmed and NFC-normalized, bounded
   by field-specific limits, and reject control characters, markup-like input,
   and common injection signatures. Passwords are length/control-checked but
   retain their exact value: they are never trimmed, lowercased, or normalized.
   Optional fields remain optional; required fields cannot be whitespace-only.
3. **Preserve Unicode.** Policies do not use ASCII-only content allowlists.
   Greek, accented and combining-mark text, and mixed Greek/Latin content are
   accepted. Dates, times, UUIDs, enums, booleans, arrays, and numeric values
   use strict runtime shapes; invalid numeric strings are rejected instead of
   being silently truncated or defaulted.
4. **Parameterize persistence.** Database access continues to use Drizzle
   expressions and bound parameters. User input must never be interpolated into
   SQL, shell commands, file paths, or generated markup.
5. **Encode on output.** The mobile app renders user-controlled values through
   React Native `Text` (and equivalent escaped text components). API error
   messages are bounded and treated as plain text; no raw HTML, `innerHTML`,
   `dangerouslySetInnerHTML`, or HTML WebView path is allowed.

The generated OpenAPI/client artifacts describe the public contract, but
generated types are not the security boundary. `customFetch` performs the same
shared request-body validation for immediate client-side feedback, while the
server repeats it authoritatively and returns only generic, localization-ready
400 error codes.

When adding a user-controlled field, add its strict schema and route mapping
before persisting or displaying it, update the OpenAPI request contract, rerun
code generation, and add negative and Unicode regression coverage. Future
language support must extend the shared Unicode-safe policy rather than
introducing a locale-specific bypass or destructive keyboard filter.