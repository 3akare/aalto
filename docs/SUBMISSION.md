# Sahara CodeSwitch Africa — form answers

Copy-paste ready. Word counts are against each field's limit. Anything in
**[brackets]** needs a real number once the benchmark finishes.

---

**Website** — `https://github.com/3akare/aalto`

**Solution Title** — `Aalto — voice-driven civic form access for code-switched speech`

---

### 1. Problem (~50 words) — *50*

Nigeria's civic processes have moved onto English-only digital forms: business
registration, permits, aid intake, enrolment. Most Nigerians don't speak English
the way those forms are written — they speak code-switched Yoruba-English,
Hausa-English, Pidgin. Mainstream speech recognition is built for monolingual
speech and fails on exactly the switched words, often silently.

### 2. Target users and potential scale (~50 words) — *50*

Anyone completing a government form online who is more fluent speaking than
typing formal English: applicants, small business owners, and the health and
extension workers who do intake on others' behalf. Nigeria alone has over 200
million people for whom English is an official second language, not a first
one.

### 3. How it solves the problem (~50 words) — *50*

Press Alt+A, speak naturally — mixing languages mid-sentence — and stop. Aalto
transcribes with Sahara, works out what you meant, fills the form's fields by
matching your words to its real questions, reads your answers back before you
submit, and answers questions in place so you never leave the page.

### 4. Does your solution support code-switching? — **Yes**

### 5. Does your solution use the Sahara APIs? — **Yes**

*(Sahara STT streaming for every transcription on the live path; Sahara TTS for
every spoken reply.)*

### 6. How is it agentic? What downstream task does the transcript enable? (~50 words) — *49*

One utterance becomes a plan of several tasks, run concurrently. "My name is Ada
Okafor, my phone is zero eight zero three..., remind me to file Friday" fills two
form fields and creates a task. The downstream task is civic form completion: the
transcript becomes field values, not text.

### 7. Technical overview (~250 words) — *232*

**Streaming STT over the sync endpoint.** Sahara's `/file/v1/upload/sync`
rejected anything past ~5 seconds on our account with "insufficient balance"
while the streaming handshake reported healthy credit. Spoken commands routinely
run longer, so everything moved to the WebSocket API. Tradeoff: streaming is
stateful and needs timeout scaling per clip length, plus retry handling for
per-language model warm-up — but it is also Sahara's production path.

**Recording in an offscreen document.** Chrome destroys an extension popup the
moment it loses focus, which is exactly when Aalto opens or switches a tab —
recording in the popup died during almost every command. An offscreen document
survives; a service worker can't, having no DOM. Tradeoff: more message-passing
and lifecycle code for an interaction that otherwise cannot work at all.

**A planner over typed tools, not keyword matching.** Transcripts are
code-switched and carry ASR noise, so intent resolves through a model over a
fixed tool schema. Several tool calls in one response is what makes concurrent
fan-out possible. Tradeoff: latency and cost per utterance against tolerating
phrasing no regex would survive.

**Guarding irreversible actions in code.** A plan containing both field-fills and
a submit has the submit stripped and replaced with a prompt to review. The system
prompt forbids it too, but a prompt is guidance; submitting unseen answers to a
government body is not recoverable. Tradeoff: an extra turn, for a guarantee
rather than a request.

### 8. Ethics / Inclusion (~100 words) — *99*

We record nobody. Benchmarking uses AfriSwitch, whose contributors already
consented, so our duty is honouring that: the audio is CC BY-NC-SA and is never
redistributed — only metrics and a manifest letting anyone reconstruct our sample
from source. The microphone opens per command and closes on silence; no wake
word, no always-on listening. Form contents are never logged or transmitted
elsewhere. One shortfall we disclose rather than hide: Gemini calls used a
free-tier key that may retain data for training, against our own stated standard.
Ambiguous matches ask instead of guessing, and submission is always a separate,
deliberate act.

---

## Demo Video URL

Max 5 minutes, public or unlisted, **must visibly show code-switching**.
Script and form spec: [DEMO.md](DEMO.md).

## Benchmark Report Link

**PDF, max 3 pages**, hosted on Drive with link sharing on.
Source: [BENCHMARK_REPORT.md](BENCHMARK_REPORT.md) → condensed to
`BENCHMARK_REPORT_3PAGE.pdf`.

Must contain: 3+ models including Sahara with pros/cons · data source, languages,
sample sizes and hours, preprocessing · metrics and why they suit the task ·
per-language WER/CER table · downstream-task performance table · qualitative
strengths and weaknesses per model per language.

## Benchmark Audios Link (optional)

**Leave blank, and say why in the description if there is room.** AfriSwitch is
CC BY-NC-SA 4.0 — non-commercial, share-alike. Re-uploading those clips to our
own HuggingFace dataset would redistribute audio we were given under terms that
do not permit it. Declining on licence grounds is consistent with the ethics note;
quietly skipping the field is not.
