# Aalto - Solution Description

**Category:** Other High-Impact Use Cases - accessibility
**Demonstrated on:** civic and public-service forms

---

## Problem

Digital services assume you can type, in English, in the register the form was written in. That
assumption excludes a great many people, and the exclusion is invisible because it looks like a
personal failing rather than a design choice.

Nigeria's official language is English. Most Nigerians do not speak it the way official forms are
written. What people actually speak is code-switched - Yoruba-English, Hausa-English, Igbo-English,
Pidgin - switching language mid-sentence, often mid-clause, without noticing they are doing it. Add
limited literacy, or a small phone keyboard, or a queue, and a form that is theoretically available
is practically closed.

Civic processes have moved onto digital forms: business name registration, permit applications,
community surveys, aid intake, school enrolment. Those forms are English-only and text-only. That is
a quiet exclusion of anyone who is more fluent speaking than typing, anyone whose English is
conversational rather than bureaucratic, and anyone filling a form on a phone in a queue.

The gap is not that speech interfaces do not exist. It is that mainstream speech recognition is
built and evaluated on monolingual speech. A system that transcribes clean English well can fail
badly on a sentence that starts in Yoruba and finishes in English - and, worse, can fail *silently*,
returning fluent-looking output that has dropped or mangled exactly the switched words. The
AfriSwitch corpus exists because this is a measurable, unsolved problem across 12+ African
languages; published baselines on it sit between 24% and 90% word error rate depending on language.

Aalto is an accessibility tool: it lets someone reach a digital service by speaking, in the language
they actually speak, rather than by typing in one they do not. Civic forms are where that matters
most and where it is demonstrated here, because the cost of exclusion is highest when the service is
a government one you cannot opt out of.

## Target users

Anyone shut out of a text-and-English interface: people more fluent speaking than typing, people
whose English is conversational rather than bureaucratic, people with limited literacy, and people
for whom a small keyboard is the obstacle.

Demonstrated on the group where the stakes are highest - people completing civic and public-service
processes online: applicants and small business owners filing registrations, community health and
extension workers doing intake on someone else's behalf, and anyone managing the follow-up admin a
civic process generates ("remind me to bring my ID on Friday").

Secondary, and the reason the product is usable day-to-day rather than only at a registration desk:
anyone who wants to ask a question or capture a task without leaving what they are doing.

## Solution

Aalto is a voice agent that lives in the browser. Press `Alt+A`, speak, stop speaking. It listens,
works out what you meant, does it, and tells you.

The organising principle is **do not move the user**. Someone halfway through a form should not be
thrown into a search results page because they asked what a term meant. So Aalto:

- **Answers in place.** "What does CAC stand for?" returns a spoken and written answer in the panel.
  It only searches the web when the answer genuinely depends on something current or local that a
  model should not state from memory - verified: "latest fuel price in Lagos" correctly routes to
  search, "what does CAC stand for" does not.
- **Works in the background.** Tabs it opens are opened *behind* what you are doing. Todoist tasks
  need no tab at all. You get "added, and opened the portal in a background tab", not a context switch.
- **Fills Google Forms by voice**, matching what you said to the form's actual visible question text.
  One sentence can fill several fields, and spoken digits land as digits - *"my phone is zero eight
  zero three four five six seven eight nine zero"* becomes `08034567890`, which matters because civic
  forms are mostly phone numbers, NINs and dates.
- **Reads the form back.** "What is this form asking me?" reads the questions; "read back what I've
  filled in" reads every question with its current value, blanks included. For someone facing an
  English-only government form they cannot comfortably read, this is the part that actually opens the
  door.
- **Manages Todoist** - add, complete, update - matched fuzzily from a spoken description.

Replies arrive as text. A button reads one aloud through Intron TTS when that is wanted, which in an
office or a waiting room usually is not.

## Why this is agentic, not a voice UI

Three specific properties, each of which is a design decision rather than a side effect:

**One utterance becomes a plan of N tasks, executed concurrently.** *"Open the CAC portal, search for
business name registration, and remind me to file on Friday"* produces three tool calls from a single
planning pass. Server-side work (Todoist) runs concurrently with `Promise.allSettled`; browser-side
work is dispatched to the extension, where independent actions run in parallel and form fields run in
order, because they share one page. One task failing never sinks the batch - you get the two that
worked and an honest account of the third.

**The summary describes what happened, not what was dispatched.** The extension posts real per-task
outcomes back to the server, which produces one spoken sentence from them. A task that failed says so.

**It refuses to submit what you have not seen.** A plan containing both field fills and a submit has
the submit removed before anything executes, and the user is told to review first. This is enforced
as a function with tests, not only as a line in the system prompt - a civic form submitted with wrong
answers is not something the applicant can take back.

**It asks rather than guesses, where guessing is unrecoverable.** An ambiguous Todoist match ("the ID
card thing" matching two open tasks) returns a clarifying question instead of closing one. A radio
button on a form whose options do not match what you said is left alone and reported, rather than
being set to the first option - which is what the original implementation did, silently, while
returning failure.

## Architecture

```
Extension                          Server (local)                 Providers
─────────                          ──────────────                 ─────────
offscreen document                 POST /api/voice-command
  mic + silence detection   ──audio──►  transcode → 16k mono WAV
  speaker                                 │
                                          ├─ STT ───────────────► Intron streaming
background service worker                 ├─ plan ──────────────► Gemini (tools)
  orchestrates, survives                  └─ execute server-side ► Todoist v1
  the popup closing         ◄─tasks───
  runs browser tasks
                            ──results─►  POST /api/complete
popup                                     ├─ summarise ─────────► Gemini
  view only                               └─ speak ─────────────► Intron TTS
```

### Key technical decisions

**Streaming STT, not the sync endpoint.** Intron's `/file/v1/upload/sync` rejects anything longer
than about five seconds on our account with `"insufficient balance to process the file"` -
reproducibly, on both 176KB and 94KB encodings of the same clip, while the streaming session
handshake reports a healthy `credit_balance`. Spoken commands routinely exceed five seconds and
AfriSwitch utterances average about twelve, so the sync path is unusable regardless of the error
message. Everything runs over the WebSocket streaming API.

**Recording lives in an offscreen document.** Chrome destroys an extension popup the moment it loses
focus - which is precisely when Aalto opens or switches a tab. Recording in the popup meant recording
died during almost every command it exists to run. An offscreen document survives; a service worker
cannot do the job either, because it has no DOM and therefore no `getUserMedia` and no `Audio`.

**Commands end on silence, not on a button.** The offscreen worker measures input RMS, commits after
~1.1s of quiet following speech, gives up after 4s of nothing, and caps an utterance at 25s. Pressing
the shortcut *is* the request to talk, so the popup it opens is already listening. Opening the popup
by hand shows a record button and waits - a window that started recording because you glanced at it
would be a different product.

**Gemini for planning, with a tool schema.** The transcript may itself be code-switched and carry ASR
noise, so intent is resolved by a model over a fixed set of typed tools rather than keyword matching.
Multiple `function_call` steps in one response is what makes the fan-out possible.

**Audio is normalised once, at the edge.** Every provider receives byte-identical 16 kHz mono PCM16
WAV. On the live path this fixes a real bug (the extension records WebM/Opus, which was being labelled
`audio/wav` on the wire). On the benchmark path it is a fairness requirement.

**Form matching is containment-biased.** Google Forms does not expose clean `label for=""` bindings,
so the content script matches spoken labels against rendered question text. Normalising by the
*larger* token set - the obvious implementation, and the original one - meant a spoken "name" scored
0.17 against "What is your full legal name?" and fell below threshold; short spoken labels failed
against verbose questions as a rule. Dividing by the smaller set asks the right question: is what
they said contained in this question?

**Security.** The server holds the user's Intron, Gemini and Todoist credentials, so the API is
gated by a shared secret header and a CORS origin allowlist, and startup fails fast on missing
configuration rather than surfacing missing credentials later as opaque 500s.

## Benchmark

The code-switching benchmark is the substance of this submission and has its own document:
**[`BENCHMARK_REPORT.md`](./BENCHMARK_REPORT.md)**, generated by `npm run benchmark`.

In short: Intron Sahara, AssemblyAI Universal-3.5 Pro and Gemini 3.5 Transcribe, evaluated on a
frozen, pre-registered sample under the corpus paper's own protocol, with the confidence intervals, paired significance tests and
code-switching-specific metrics that the corpus paper does not report. It uses the gold `[[EN]]` span
tags to measure error *at the switch points themselves*, which is the failure aggregate WER hides.

The report is written to be read adversarially: it opens with provenance and a conflict-of-interest
statement (the corpus publisher also makes one of the evaluated systems), states the fairness
protocol and its residual risks before any result, and tests whether the model ranking survives three
normalisation regimes of increasing severity.

## Running it

```bash
cd server && npm install && cp .env.example .env   # fill in credentials
npm run dev
```

Then load `extension/` unpacked at `chrome://extensions` (Developer mode → Load unpacked), grant the
microphone once on the page that opens, and press `Alt+A`.

`npm run smoke` checks every credential and provider end to end without touching the dataset.

## Ethics & inclusion

See [`ETHICS.md`](./ETHICS.md).
