// Backslash, tab, and newline all get normalized away by the WHATWG URL
// parser browsers use (the same parser behind `router.push`'s own
// same-origin check) before it looks for "//" — so "/\evil.com" and
// "/\t/evil.com" both resolve to "https://evil.com" despite starting
// with a single forward slash. Confirmed directly: `new URL("/\\evil.com",
// "https://good.example").href` -> "https://evil.com/".
const UNSAFE_CHARS = /[\\\t\n\r]/;

/**
 * Validates a `?next=` value before using it as a client-side redirect
 * target. Must be a same-origin relative path — rejects protocol-relative
 * URLs ("//evil.com"), absolute URLs ("https://evil.com"), backslash/
 * tab/newline variants that a browser's URL parser would normalize into
 * one of those, and anything else that isn't a plain in-app path, so an
 * attacker-crafted link like "/login?next=https://evil.com" can't
 * redirect a freshly-authenticated user off-site.
 */
export function safeRedirectPath(
  value: string | null,
  fallback: string,
): string {
  if (value && /^\/(?!\/)/.test(value) && !UNSAFE_CHARS.test(value)) {
    return value;
  }
  return fallback;
}
