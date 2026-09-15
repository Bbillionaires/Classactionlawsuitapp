/**
 * Validates a `?next=` value before using it as a client-side redirect
 * target. Must be a same-origin relative path — rejects protocol-relative
 * URLs ("//evil.com"), absolute URLs ("https://evil.com"), and anything
 * else that isn't a plain in-app path, so an attacker-crafted link like
 * "/login?next=https://evil.com" can't redirect a freshly-authenticated
 * user off-site.
 */
export function safeRedirectPath(
  value: string | null,
  fallback: string,
): string {
  if (value && /^\/(?!\/)/.test(value)) return value;
  return fallback;
}
