// Defense-in-depth CSRF check for cookie-session-authenticated, state-changing routes.
// Browsers always attach an Origin header on a cross-site POST/PATCH/DELETE, so a real
// browser can never bypass this; it only rejects requests whose Origin doesn't match (or
// is altogether missing, which a legitimate same-origin browser request won't be).
export function requireSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}
