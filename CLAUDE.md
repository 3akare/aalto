# Aalto — context for continuing in Claude Code

## What this is
Voice-controlled browser agent for two hackathon submissions:
1. **Sahara/Intron** (due Sept 15, 11:59pm WAT) — category: Legal & Public Services (civic form
   accessibility). Requires benchmarking 3+ STT models including Intron. Highest-weighted criterion
   is benchmark quality (30%), then product/UX fit (25%), real-world impact (20%), technical execution
   (15%), ethics (10%).
2. **AssemblyAI** (due Sept 30) — reuse the same agent, swap/add AssemblyAI's Voice Agent API or
   Realtime STT as the primary engine for that submission. No code-switching requirement there.

## Status as of last session
Scaffolded and type-checks cleanly:
- `server/` — Node/TS orchestrator. STT abstraction (Intron sync + streaming, Whisper, AssemblyAI),
  Intron TTS, Claude-based intent router (`src/orchestrator/intentRouter.ts` + `tools.ts`), Todoist
  client, Express API (`src/index.ts`), benchmark harness (`src/benchmark/`).
- `extension/` — Manifest V3 Chrome extension. Popup (hold-to-talk mic), background service worker
  (tabs/search actions), content script for Google Forms field-filling by label-matching.
- `docs/` — SOLUTION.md and ETHICS.md drafts with `[bracketed]` placeholders still to fill in with
  real specifics once the demo/benchmark are run.
- `benchmark/audio-samples/` — empty, needs real recorded code-switched clips + reference .txt files.

## Not yet done / next steps
1. `npm install` in `server/`, fill in `server/.env` with real keys (Intron, Anthropic, Todoist,
   optionally OpenAI + AssemblyAI for the benchmark comparison models).
2. Record 10-20 code-switched audio clips per `benchmark/audio-samples/README.md`, run
   `npm run benchmark`, and use `benchmark/results/latest.md` to fill in `docs/SOLUTION.md` and write
   the qualitative pros/cons section.
3. Load the extension unpacked (`chrome://extensions` → Developer mode → Load unpacked → `extension/`),
   test end-to-end against a real Google Form.
4. `fill_form_field` matching is a simple token-overlap heuristic (`content-forms.js` `similarity()`)
   — may need tuning against the actual demo form's exact question wording.
5. Record the demo video once the flow works end-to-end.
6. Write the actual Solution Description / Ethics note content (currently drafts with placeholders).
7. Only after Sahara ships: adapt for AssemblyAI — likely swap in their Voice Agent API for the primary
   STT/orchestration path, drop the code-switching framing, keep the browser+Todoist feature set (that
   part already fits AssemblyAI's originality/business-value criteria as-is).

## Key constraints to remember
- Intron STT sync endpoint: 120s audio max. Streaming endpoint: 300s session max, 60s max idle gap,
  1-32KB PCM16 chunks.
- Intron TTS: 4096 char max per request.
- Sahara submission is one-shot — no resubmission once filed.
