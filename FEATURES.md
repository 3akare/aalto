# Feature tracker

The application broken into features, each hardened and committed on its own so
the git history reads as the build order. A feature is **done** only when every
box in the definition of done is ticked.

**Definition of done (every feature)**

- [ ] Code review: correct, readable, matches the surrounding idiom
- [ ] Security review: trust boundaries, input validation, secrets, injection
- [ ] UX review: error messages, a11y, failure states (where it has a UI)
- [ ] Resource review: listeners, timers, media, sockets released; no unbounded growth
- [ ] Tests: behaviour covered, each bug found has a failing test written first
- [ ] `npm test` and `npm run lint` pass
- [ ] Committed with a short, imperative message

Status: `todo` · `in progress` · `done`

---

## F00 · Project scaffold and tooling — `done`

Root config, docs, licences, the shared-code sync script, and a test harness.
Files: `package.json`, `biome.json`, `.gitignore`, `README.md`, `DESIGN.md`,
`LICENSE`, `NOTICE.md`, `scripts/sync-shared.mjs`, `.claude/launch.json`

Findings

- [x] No test runner or tests anywhere in the project → added Vitest (happy-dom for DOM code)
- [x] `npm run sync-shared` had no check mode → added `--check` and `npm run verify`
- [x] No CI → added in F12

## F01 · Fuzzy matching — `done`

Spoken phrase → field, option, or tab. Dates in plain English.
Files: `shared/matching.js`

Findings

- [x] `toIsoDate` accepted impossible dates (`31/02/2024` → `2024-02-31`), bare numbers, and threw on non-strings → now refuses them
- [x] Unit tests for normalisation, similarity, the never-guess threshold, dates (25 tests)
- Note: numeric dates are day-first by design; documented in the code

## F02 · Page navigation — `done`

Scroll, jump to a section, find on page, highlight matches.
Files: `shared/page-nav.js`

Findings

- [x] `mark()` assumed `document.head` exists and threw on SVG/XML documents → falls back to the root element
- [x] 13 DOM tests: find across formatting, step/wrap, script exclusion, sections, id fallback, scrolling
- Resource check: `found` holds at most `MAX_MATCHES` ranges and is replaced on each search

## F03 · Tool contract and agent definition — `done`

The tool schema sent to AssemblyAI, the system prompt, the session frame.
Files: `shared/tools.js`, `shared/agent-config.js`

Findings

- [x] **Security:** the prompt had no rule that page text, search results and tool output are data, not instructions (an indirect prompt-injection path to `close_tabs`, `open_url`, `fill_field`) → added `WHAT YOU READ IS UNTRUSTED`. Defence in depth: the code guards in F08/F09 still hold whatever the model does
- [x] Contract tests: unique names, every tool routed (and nothing extra), schema shape, session frame
- [x] The contract is now deep-frozen
- [x] Removed `MUTATING_PAGE_TOOLS` (promised a no-race guarantee that nothing enforced) and the unused `TOOL_NAMES`

## F04 · Voice protocol client — `done`

WebSocket session, deferring tool results until `reply.done`, barge-in.
Files: `shared/agent-session.js`

Findings

- [x] **Leak:** `#waitFor` never removed its `message` listener → removed on resolve and on timeout
- [x] `connect()` hung forever if the socket opened but `session.ready` never arrived → 15 s timeout that closes the socket
- [x] Tool results finishing after `end()` were queued against a dead session → dropped
- [x] 18 tests on a fake socket: deferral until `reply.done`, interruption, barge-in, PCM round-trip, end/close, listener counts

## F05 · Audio pipeline — `done`

Microphone resampling worklet, and streamed speech playback.
Files: `shared/pcm-worklet.js`, `shared/speaker.js`

Findings

- [x] **Bug:** at device rates whose ratio doesn't divide the 128-sample quantum (e.g. 88.2 kHz), the read position overshot the buffer and samples were dropped (audio drift) → overshoot carried in `readPos`. Red on the old code, green on the new
- [x] **Performance:** `process()` allocated two typed arrays per quantum (~375/s on the real-time thread) → one reusable buffer
- [x] 15 tests: resampling at 16 k–192 kHz, seam continuity, clamping, speaker scheduling, idle, `stop()` cut-off

## F06 · Token Worker and demo budget — `done`

Cloudflare Worker: static site, single-use token minting, daily budget ledger.
Files: `web/worker/*`, `web/wrangler.jsonc`, `web/package.json`

Findings

- [x] **Bug:** the demo and the extension shared one `budget` row per day despite separate caps, so demo use locked out the extension → separate pools (`ext:` prefix; the demo keeps the bare date for continuity)
- [x] **Security:** a missing or non-numeric cap was `NaN`, and `granted + s > NaN` is false, so the cap **failed open** and minting was unlimited → caps validated, fail closed (500)
- [x] `release` didn't validate `leaseId`, so non-strings reached SQL bindings → UUID only
- [x] The upstream mint had no timeout and held leases on a hung request → 8 s abort; the token type is checked
- [x] Refunds used `today()` twice, so a mint straddling midnight could refund the wrong day → day captured once
- [x] No security headers → `_headers`: strict CSP, nosniff, HSTS, COOP, Permissions-Policy (mic self only), frame-ancestors none. Verified served by `wrangler dev`, page renders with no CSP violations
- [x] `budget` rows were never pruned → kept 30 days
- [x] `tsc --strict` type-check and `wrangler deploy --dry-run` added (`npm run check` in `web/`); wrangler/typescript pinned
- [x] `launch.json` ran an unpinned `npx wrangler` from the root → uses the pinned one in `web/`
- [x] 26 tests: the real ledger SQL on node:sqlite via a `cloudflare:workers` shim, plus routes, CORS, rate limit, refunds, release validation

## F07 · Website and live demo — `done`

Landing page, showcase animation, and the in-page sandbox the agent drives.
Files: `web/public/**` (except `vendor/`)

Findings

- [x] **Leak:** `Mic.stop()` never closed its `AudioContext`, so each session leaked one, and Chrome caps live contexts → closed on stop
- [x] **Bug:** `closeOpened` closed any tab with *any* word overlap (score > 0), and "the tabs you opened" closed nothing → threshold match, and "you opened" means all, as in the extension
- [x] **Bug:** transcript deltas were shown one word at a time (the line blanked on every word) → accumulated per turn
- [x] Verified in `wrangler dev`: modules load under the new CSP with no console errors
- [x] 14 tests against the real `index.html` markup: read-back guard, never-guess, tabs, mic lifecycle
- [x] Served `aalto-1.0.0.zip` was a hand-built artefact → generated in F12
- Accepted: the showcase polls every 400 ms while off screen; cheap and cancellable

## F08 · Extension: page agent (content script) — `done`

Reads, writes, and fills forms on any page.
Files: `extension/content-agent.js`

Findings

- [x] **Security:** password, card, CVC and one-time-code fields were read into `get_context`, `read_text field` and `review_form`, sending their values to the LLM, and could be typed by voice → `isSensitive()`: reads say "(filled, hidden)", writes are refused
- [x] **Bug:** `submit_form` clicked the first "Send"/"Submit" anywhere on the page (a header search, a chat widget) → scoped to the form last filled; disabled buttons skipped
- [x] `ensureHighlightStyle` threw on documents without `<head>`
- [x] Non-string tool args from the model are coerced; the sync listener no longer holds the channel open
- [x] Select read-back uses `options[selectedIndex]` (robust across DOM implementations)
- [x] 17 tests: secrets never leave the page, fills, dates, never-guess, dropdowns, scoped submit, dictation
- F09 follow-up: `get_context` must describe a `sensitive` field without its contents

## F09 · Extension: background (sessions, tools, guards, tabs, macros) — `done`

Files: `extension/background.js`, `extension/manifest.json`

Findings

- [x] **Security:** `onMessage`/`onConnect` trusted any sender, so a compromised content script could call `RUN_TOOL` on every tab → only this extension's own pages (no `sender.tab`)
- [x] **Security:** the submit guard survived navigation, so form A's read-back vouched for form B in the same tab → cleared on any URL change (pushState included)
- [x] **Security:** page text could contain `>>>` and break out of the untrusted-quote fence → markers neutralised inside quotes
- [x] **Security:** `open_url` accepted `javascript:`, `file:`, `chrome:`, `data:`, and mangled `HTTP://` → http(s) only, case-insensitive, `host:port` handled
- [x] **Security:** the settings endpoint could be plain http (token in clear) or garbage → https only, http allowed for localhost
- [x] **Leak:** guards for closed tabs were never removed, and `recorded` grew without bound → cleared on close, capped at 50
- [x] `get_context` describes a sensitive field without its contents (pairs with F08)
- [x] 33 tests on a fake `chrome`: sender trust, guards, URL policy, fencing, tabs, macros, endpoint policy

## F10 · Extension: offscreen audio — `done`

Files: `extension/offscreen.js`, `extension/offscreen.html`

Findings

- [x] **Privacy:** the microphone was held open after a session ended (recording indicator on, device held while idle) → tracks stopped on every stop; the AudioContext is suspended, not leaked
- [x] **Race:** two concurrent `START_SESSION`s both passed the `if (session)` check → `starting` flag; one mic, one socket
- [x] **Security:** no sender check → service worker only
- [x] 6 tests: mic release, restart, concurrent start, sender trust, error names, copy

## F11 · Extension: side panel and permission page — `done`

Files: `extension/sidepanel.*`, `extension/permission.*`, `extension/icons.js`

Findings

- [x] **Security:** `permission.js` wrote the browser's error message into `innerHTML` (test proved an `<img onerror>` became live markup) → built as DOM nodes
- [x] **UX/trust:** the permission page said Aalto "records only while you hold the talk button", but it's a toggle that stays on until stopped or 90 s quiet → copy corrected
- [x] **UX:** the endpoint setting saved anything silently → validated with the same https rule as F09, inline error, `aria-invalid`, "Saved." confirmation, normalised to an origin
- [x] **A11y:** status pill and permission status are `role="status"`; the feed is `role="log"` but deliberately not live (replies are already spoken aloud)
- [x] The `!important` lint suppression sat on the wrong line → moved onto the declaration
- [x] 11 tests: markup safety, copy, settings validation, status, transcript rendering
- Accepted: two `noDescendingSpecificity` warnings where the later, lower-specificity rule is intended to lose

## F12 · Release packaging and CI — `done`

Files: `scripts/package-extension.mjs`, `.github/workflows/ci.yml`

- [x] The served zip was hand-built and shipped 13 stale files (none of this hardening) → `npm run package` builds it from `extension/`; `package:check` compares contents and fails on drift
- [x] CI (GitHub Actions, read-only token): sync check, zip check, lint, tests, Worker type-check, wrangler dry run
- [x] Background tests left debounce timers firing after teardown (unhandled errors in the full run) → fake timers, cleared per test; 3 consecutive clean runs

---

## Log

| Feature | Commit | Notes |
| --- | --- | --- |
| F00 | `chore: scaffold tooling, tests and tracker` | Vitest, Biome 2.6.4 pinned, sync check mode |
| F01 | `feat(matching): add fuzzy label and date matching` | TDD: 5 red → green |
| F02 | `feat(page-nav): add scroll, section and find-on-page` | TDD: head-less document red → green |
| F03 | `feat(agent): add tool contract and system prompt` | TDD: freeze + injection rule red → green |
| F04 | `feat(session): add voice protocol client` | TDD: 3 red (leak, hang, stale result) → green |
| F05 | `feat(audio): add capture worklet and speaker` | TDD: 88.2 kHz drift red → green |
| F06 | `feat(worker): add token minting and demo budget` | TDD: 8 red (fail-open cap, shared pool, timeout, …) → green |
| F07 | `feat(web): add landing page and live demo` | TDD: mic leak + close_tabs red → green |
| F08 | `feat(extension): add page agent content script` | TDD: secret leak + wrong-form submit red → green |
| F09 | `feat(extension): add background tool dispatch` | TDD: 19 red (sender trust, guard reuse, URL policy, …) → green |
| F10 | `feat(extension): add offscreen mic and socket` | TDD: mic held open + start race red → green |
| F11 | `feat(extension): add side panel and permission page` | TDD: 8 red (innerHTML injection, settings, copy) → green |
| F12 | `build: package the extension zip and add CI` | Zip regenerated from hardened source |

## Not done, and why

- **Live check (2026-11-03), protocol level only.** With a real key: the local Worker minted a token, the shipped `AgentSession` reached `session.ready` in ~1.1 s, ended with `session.ended`, and the lease was released. Speech in and out (microphone, playback) has not been exercised live.
- **Extension not loaded in Chrome by these checks.** The chrome.* surface is covered by an in-memory fake. Before release, load `extension/` unpacked and run one session.
- **Prompt injection is reduced, not eliminated.** The prompt rule, delimiter fencing, and the code guards (read-back before submit, never-guess, sensitive fields, URL policy, sender trust) bound what a hostile page can make the agent do. An LLM reading untrusted pages can still be misled into, say, closing a tab.
