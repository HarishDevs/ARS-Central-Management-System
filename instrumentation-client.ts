import { config } from "zod";

// v1.89.0 (D-422): Zod 4 checks once whether it may compile validators with
// `new Function` (a "Function('')" probe). The app's strict CSP (no
// 'unsafe-eval', lib/security/csp.ts) refuses it, which is fine (Zod then
// validates without compiling), but Firefox logs every refusal as a CSP error
// in the console on each page. Telling Zod up front not to try keeps the CSP
// as strict as it is and the console clean. Runs in the browser before the
// app's code (Next.js instrumentation-client); the server is unaffected.
config({ jitless: true });
