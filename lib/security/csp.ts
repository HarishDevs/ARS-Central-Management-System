// Content-Security-Policy (P1-34a, D-051). Pure, so it is unit-tested and
// usable from middleware (Edge runtime: no Node imports here).
//   - Scripts only with this request's nonce ('strict-dynamic' lets Next.js
//     and Firebase load their own chunks from those).
//   - Google sign-in needs the Firebase auth domain (popup + hidden iframe)
//     and Google's token endpoints (D-038).
//   - No framing by anyone (frame-ancestors 'none'), no plugins, forms post
//     only to this site.
export interface CspOptions {
  dev: boolean;
  firebaseAuthDomain: string;
  /** v1.89.0 (D-419): leave out upgrade-insecure-requests for this request (see keepsLocalHttp). */
  localHttp?: boolean;
}

// v1.89.0 (D-419): browsers such as WebKit apply upgrade-insecure-requests to
// http://localhost too, so a local production build (the e2e and QA runs)
// loads no scripts or styles. The directive is left out only for a loopback
// host (localhost, 127.0.0.1, [::1]) and only when not in production, or when
// the server was started with the explicit test flag E2E_LOCAL_HTTP=1. Any
// other host, and production without the flag, keeps it.
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
export function keepsLocalHttp(host: string | null | undefined, env: { nodeEnv?: string; e2eLocalHttp?: string }): boolean {
  const raw = (host ?? "").trim().toLowerCase();
  // A port is dropped ("localhost:3280", "[::1]:3280"); a bare IPv6 address is kept as it is.
  const name = /^\[[^\]]*\]:\d+$/.test(raw) || /^[^:]+:\d+$/.test(raw) ? raw.slice(0, raw.lastIndexOf(":")) : raw;
  if (!LOOPBACK.has(name)) return false;
  return env.nodeEnv !== "production" || env.e2eLocalHttp === "1";
}

export function buildCsp(nonce: string, options: CspOptions): string {
  const scriptSrc = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", "https://apis.google.com"];
  // React dev tooling needs eval; never in production.
  if (options.dev) scriptSrc.push("'unsafe-eval'");
  const connectSrc = [
    "'self'",
    "https://identitytoolkit.googleapis.com",
    "https://securetoken.googleapis.com",
    "https://www.googleapis.com",
  ];
  if (options.dev) connectSrc.push("ws:", "wss:");

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": scriptSrc,
    // Next.js and next/font inject inline <style>; styles can't run code.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'"],
    "connect-src": connectSrc,
    // D-251: the service worker (/sw.js) is this site's own file; 'strict-dynamic'
    // above would otherwise refuse it. Manifest likewise.
    "worker-src": ["'self'"],
    "manifest-src": ["'self'"],
    "frame-src": [`https://${options.firebaseAuthDomain}`, "https://accounts.google.com"],
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "object-src": ["'none'"],
  };
  const policy = Object.entries(directives).map(([name, values]) => `${name} ${values.join(" ")}`);
  if (!options.dev && !options.localHttp) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}

export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
