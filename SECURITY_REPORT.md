# Application Security Report — `the-last-colony`

**Engagement:** Full-repository white-box review (source, configuration, dependencies)
**Date:** 2026-08-27 · **Branch:** `feat/multilingual-accessibility-v2` (clean, merged as PR #4)
**Method:** Four independent parallel audit passes (API/auth surface · client/rendering/model layer · scripts/pipeline package · dependencies/config), followed by direct manual verification of every security boundary and adversarial validation of each candidate finding. All SQL call sites, all 11 route handlers, the auth module, and every dangerous-sink pattern (`eval`/`exec`/`dangerouslySetInnerHTML`/raw SQL) were traced to their data sources.

---

## Phase 1 — Architecture & Dependency Review

### System architecture and trust boundaries

| Component | Trust posture |
|---|---|
| Next.js 16 App Router app (root, `src/`) | Public web surface; 11 route handlers |
| `/kitchen` analytics dashboard | Gated by `KITCHEN_PASSWORD`; fails closed to 404 when unset |
| `/api/email-report` | Gated by `EMAIL_REPORT_TOKEN`; fails closed to 404 when unset |
| `pipeline/` (second npm package) | Developer-run only; its retrieval code also ships in the app via the `@pipeline/*` alias |
| Neon Postgres, Pinecone, Anthropic, Google GenAI | Server-side only; ~10 credentials across 4 vendors, none reachable from client code |

There are no GitHub Actions workflows, no Dockerfiles, and no middleware file. Auth enforcement is per-surface: the kitchen page and the `/api/kitchen/threads` handler each independently re-check `kitchenAccess()`, so route handlers are not reachable around the page gate.

### Dependency assessment (resolved versions from lockfiles)

| Package | Resolved | Assessment (knowledge cutoff Jan 2026) |
|---|---|---|
| `next` | 16.3.1 | No known CVEs for 16.3.x. The middleware auth-bypass class (CVE-2025-29927) is fixed well before this version and is inapplicable anyway — no middleware exists. |
| `react` / `react-dom` | 19.2.4 | No known advisories. |
| `@anthropic-ai/sdk` | 0.115.0 | No known advisories. |
| `@google/genai` | 2.14.0 (root) / **1.52.0 (pipeline)** | No known advisories; note two major versions of the same SDK coexist across the packages. |
| `@neondatabase/serverless` | 1.1.0 | No known advisories. |
| `@pinecone-database/pinecone` | 6.1.4 | No known advisories. |
| `dotenv` / `tsx` / `esbuild` | 16.6.1 / 4.23.1 / 0.28.1 | Clean; esbuild is past the dev-server CORS advisory (GHSA-67mh-4wv8-2f99). |
| `protobufjs` | 7.6.5 | Past both prototype-pollution CVEs (CVE-2022-25878, CVE-2023-36665). |
| `sharp` (transitive) | 0.35.3 | Past the libwebp CVE-2023-4863 era; version is at/after knowledge cutoff — run `npm audit` to confirm. |

Versions this recent partially postdate the review's CVE knowledge; the roadmap therefore includes automated SCA rather than relying on point-in-time attestation.

### Configuration review — verified clean

- **Secrets hygiene is correct.** `.env` exists locally but is not tracked and has never been committed (verified via `git ls-files` and full-history log). Both `.env.example` files contain only empty placeholders. No key, PEM, dump, or source map is tracked. No hardcoded credential patterns anywhere in source.
- **No image-optimizer proxy surface** (no `images.remotePatterns`), no rewrites/redirects, no experimental flags, source maps off.
- `robots.ts` correctly treats hiding `/kitchen`, `/r`, `/unsubscribe`, `/api/email-report` as discoverability hygiene, not access control.
- Origin for the `/r` redirect tracker comes from the `SITE_URL` env var, never the request `Host` header — sound anti-open-redirect design.
- Minor drift: `allowScripts` pins `sharp@0.34.5` but the lockfile resolves 0.35.3, so the install-script allowlist no longer matches (integrity-control drift, not a vulnerability).

---

## Phase 2 — Source Code Vulnerability Analysis

What was examined and found **sound** (verified at the call-site level, not assumed):

- **SQL injection:** every query in `src/lib/{db,dash,email,events}` uses Neon tagged-template parameterization; zero uses of `sql.unsafe`/string-built SQL in the repo (grep-verified). The thread search escapes LIKE wildcards and length-caps terms.
- **XSS:** single `dangerouslySetInnerHTML` in the codebase (`src/components/MetaPixel.tsx:74`), fed by an env var regex-gated to `/^\d{10,20}$/`. All model/corpus output renders through JSX auto-escaping. No JSON-LD/`<script>` injection.
- **AuthN/AuthZ:** `src/lib/dash/auth.ts` uses constant-time comparison, an HMAC-SHA256-signed expiry token (password never enters the cookie), `httpOnly`/`SameSite=Lax`/`Secure`-in-prod, 12 h TTL, fail-closed 404. `/api/email-report` uses `timingSafeEqual` and returns an indistinguishable 404 for wrong-token vs. unconfigured.
- **IDOR:** the conversations mirror scopes every read, upsert, and delete by `device_id` (a `crypto.randomUUID`), including the `ON CONFLICT ... WHERE conversations.device_id = ${deviceId}` guard that prevents cross-device row takeover.
- **SSRF / open redirect / path traversal / code execution:** no request-influenced outbound fetch hosts; `/r` destinations resolve only from a server-side map; corpus file paths derive from validated slugs and an `isSupported`-checked language, never raw request input; zero `eval`/`new Function`/`child_process` in app or pipeline code (grep-verified).
- **PII:** email tracking stores a salted-SHA-256, 24-hex-char fingerprint — never a raw IP; Meta Pixel receives UTM/landing data only, no identity.

One finding survived adversarial validation.

---

## Findings

### Finding 1 — Content Spoofing via Unauthenticated Share-Card Generator

- **Vulnerability Name & Category:** CWE-451 (User Interface Misrepresentation of Critical Information) / first-party content spoofing
- **File Path & Location:** `src/app/api/share/[slug]/route.tsx` — `fromParams()`, lines 101–124, rendered into the footer at lines 241–248
- **Risk Rating:** **Medium** (CVSS 3.1 ≈ 5.3 — `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:L/A:N`; integrity of served content, no data/access compromise). Validation confidence: 7/10 — the behavior is code-verified with certainty; the score prices the impact class, not the existence.
- **Detailed Description:** The `slug === "turn"` branch of `GET /api/share/[slug]` builds the entire 1080×1350 branded share card from query parameters, applying only whitespace-collapse and length clamps. Critically, `note` (48 chars) and `kind` (48 chars) populate the two footer slots that on legitimate record cards carry `record.source.text` and `CLASS_LABEL[record.provenance_class]` — the source citation and provenance badge. A single anonymous URL such as `/api/share/turn?dish=...&verdict=...&note=Manasollasa,+12th+century&kind=Attested` therefore mints a card structurally identical to a validator-backed "Attested" record card, under the hard-coded campaign header and brand mark, served from the first-party origin. This directly contradicts the repository's central integrity invariants (AGENTS.md rules 1–2: provenance classes and citations render only from validator-enforced records; even the in-house model is blocked from naming them, with `[provenance-leak]` logging). The route's own comment (lines 20–23) asserts the turn-card footer *cannot* claim a text or class — but that holds only when the parameters are absent; the invariant lives in prose, not code. Compounding it: the share buttons that once built these URLs were removed (`IndianisationCard.tsx:114`, `RestorationCard.tsx:135`), so the `turn` branch currently has **no legitimate caller** — every request to it today is attacker traffic against a gratuitous parameter surface.
- **Remediation / Patch Solution:** Remove the caller-writable provenance slots and hard-code the turn-card footer (no legitimate client exists to break):

```tsx
// src/app/api/share/[slug]/route.tsx
function fromParams(params: URLSearchParams): CardCopy | null {
  const dish = clamp(params.get("dish"), 60);
  const headlineText = clamp(params.get("verdict"), 140);
  if (!dish || !headlineText) return null;

  const list = (key: string, max = 5) =>
    (params.get(key) ?? "")
      .split("|")
      .map((s) => clamp(s, 120))
      .filter(Boolean)
      .slice(0, max);

  return {
    dishLine: dish,
    headline: headlineText,
    then: list("then"),
    now: list("now"),
    thenLabel: clamp(params.get("thenLabel"), 18) || "Then",
    nowLabel: clamp(params.get("nowLabel"), 18) || "Now",
    steps: list("steps", 7),
    // Provenance chrome is never caller-writable. A turn card has no text,
    // no class and no source, so its footer is a constant, not a parameter.
    footerTitle: "No older version",
    footerNote: "Not drawn from a text",
  };
}
```

If the turn-share feature is not returning soon, the stronger fix is to 404 the `turn` branch entirely until it does. When client-side sharing is restored, mint share URLs server-side with an HMAC signature over the query string (the React client can hold no secret) and reject unsigned `turn` requests.

### Hardening & posture observations (explicitly *not* vulnerabilities)

1. **`KITCHEN_SECRET` / `ADMIN_SECRET` fallback** (`src/lib/dash/gate.ts:49`): each door’s HMAC signing key defaults to `<door>:${password}`, so session-token forgery reduces exactly to password entropy. Set `KITCHEN_SECRET` and `ADMIN_SECRET` to 32+ random bytes each in production to decouple them — and to *different* values: the signed message is the expiry alone, so equal secrets make a kitchen cookie valid at the pantry. *(Effort: env vars only.)*
2. **Bearer tokens in GET query strings** (CWE-598): `/api/email-report?token=…` and `/unsubscribe?t=…` place credentials in URLs (history, logs, referrers). The unsubscribe token is a deliberate, standard email pattern; for the report endpoint, additionally accept `Authorization: Bearer` and prefer it: `const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? request.nextUrl.searchParams.get("token");`
3. **Kitchen brute-force throttle is advisory:** the rate limiter is in-memory and keyed on spoofable `x-forwarded-for` (acknowledged in-code), so on serverless the real control is password entropy. Use a long random `KITCHEN_PASSWORD`; consider a durable store if the threat model grows.
4. **No security headers:** `next.config.ts` sets no `headers()`. Add a baseline (HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`); a CSP is worthwhile but needs nonce handling for the Meta Pixel inline script.
5. **No CI security gates:** the documented `npm run check && lint && build` ritual is manual. Add a workflow running it plus `npm audit --omit=dev` and a secret scanner (e.g. gitleaks) on push/PR; also re-sync the `allowScripts` sharp pin (0.34.5 → 0.35.3).

---

## Phase 3 — Executive Summary

**Overall posture: strong — materially above typical for a project of this size.** The review found **zero Critical or High vulnerabilities** and one Medium content-integrity finding. The things that most commonly sink applications in this class are demonstrably right here: every SQL statement is parameterized, the two authenticated surfaces fail closed and use timing-safe, HMAC-signed sessions, secrets have never touched git and never reach the client bundle, there is no dynamic code execution anywhere, redirects and file paths accept no request-controlled components, and per-row device scoping closes the IDOR class on the conversation mirror. Notably, the codebase's documented threat model (provenance integrity, fail-closed analytics) is actually enforced in code almost everywhere — the one place it is enforced only in a comment is Finding 1.

**Prioritized roadmap:**

| Priority | Action | Effort |
|---|---|---|
| **P1** | Fix Finding 1: hard-code (or 404) the `/api/share/turn` footer so provenance chrome is never caller-writable | ~10 lines |
| **P2** | Set `KITCHEN_SECRET`; move `EMAIL_REPORT_TOKEN` to the `Authorization` header | Minutes |
| **P3** | Add security headers in `next.config.ts` | ~20 lines |
| **P4** | Stand up CI: `npm run check` + lint + build + `npm audit` + secret scan; fix `allowScripts` drift | 1 workflow file |
| **P5** | Align the two `@google/genai` majors (1.52.0 vs 2.14.0) at next maintenance | Routine |

No emergency patching is required. P1 is the only code change with a live, reproducible abuse path, and it lands in a single small diff on an endpoint that currently has no legitimate callers.
