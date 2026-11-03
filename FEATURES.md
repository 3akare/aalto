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
- [ ] No CI → moved to F12

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

## F06 · Token Worker and demo budget — `todo`

Cloudflare Worker: static site, single-use token minting, daily budget ledger.
Files: `web/worker/*`, `web/wrangler.jsonc`, `web/package.json`

Findings

- **Bug:** the demo and the extension share one `budget` row per day despite having separate caps, so demo use locks out the extension (and the reverse)
- `release` doesn't validate `leaseId`'s type, so a non-string reaches SQL bindings
- Upstream mint `fetch` has no timeout
- No security headers on the static site (CSP, nosniff, referrer, frame-ancestors)
- `budget` rows are never pruned

## F07 · Website and live demo — `todo`

Landing page, showcase animation, and the in-page sandbox the agent drives.
Files: `web/public/**` (except `vendor/`)

Findings

- **Leak:** `Mic.stop()` never closes its `AudioContext`; each session leaks one, and Chrome caps the number of live contexts
- Served `aalto-1.0.0.zip` is a hand-built artefact that drifts from `extension/` → generate it with a script

## F08 · Extension: page agent (content script) — `todo`

Reads, writes, and fills forms on any page.
Files: `extension/content-agent.js`

Findings

- **Security:** password and payment fields are read into `get_context`, `read_text field` and `review_form`, which sends their values to the LLM; they can also be filled by voice → mask on read, refuse on write
- `submit_form` clicks the first matching button anywhere on the page, not the form that was filled → scope it to the form
- `ensureHighlightStyle` has the same `document.head` assumption as F02

## F09 · Extension: background (sessions, tools, guards, tabs, macros) — `todo`

Files: `extension/background.js`, `extension/manifest.json`

Findings

- **Security:** `onMessage` trusts any sender; a content script can send `RUN_TOOL`, `TOGGLE_SESSION` and the rest → accept only extension pages
- **Security:** the submit guard isn't cleared when a tab navigates, so a read-back of form A vouches for form B in the same tab
- **Leak:** `guards` entries for closed tabs are never removed, and `recorded` grows without bound
- `open_url` accepts any string; validate it is http(s), case-insensitively
- `workerUrl` from settings is used without validation (plain-http token transport)

## F10 · Extension: offscreen audio — `todo`

Files: `extension/offscreen.js`, `extension/offscreen.html`

Findings

- **Privacy:** the microphone stream is held open after a session ends (the recording indicator stays on) → release it on stop
- Two concurrent `START_SESSION`s both pass the `if (session)` check → guard the start
- No sender check on messages

## F11 · Extension: side panel and permission page — `todo`

Files: `extension/sidepanel.*`, `extension/permission.*`, `extension/icons.js`

Findings

- `permission.js` writes `err.message` into `innerHTML`
- Settings don't validate the endpoint URL or give feedback when saving
- The feed has no live region for screen readers

## F12 · Release packaging and CI — `todo`

Files: `scripts/package-extension.mjs`, `.github/workflows/ci.yml`

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
