# Ethics, Safety & Inclusion Note

## Consent and benchmark data

Aalto's benchmark does not use audio we recorded. It uses
[**AfriSwitch**](https://huggingface.co/datasets/intronhealth/AfriSwitch), published by Intron
Health, whose contributors consented to its collection and release under that project's terms. We
did not record, scrape, or re-use anyone's voice without their knowledge, and we did not ask
bystanders to speak for a demo.

That shifts our obligation from obtaining consent to **honouring the consent that was already
given**. AfriSwitch is licensed **CC-BY-NC-SA-4.0**, which is non-commercial and share-alike.
Concretely:

- **The audio is not redistributed.** `benchmark/audio-samples/` is git-ignored. We publish metrics,
  statistics and the sampling manifest; we do not publish the clips, and the manifest is committed
  precisely so a reader can reproduce our sample from the original source rather than from a copy of
  it we handed them.
- **Evaluation data is not sent to endpoints that train on it.** Google AI Studio's free tier may use
  submitted data for model training. Pushing an evaluation-only corpus through a training-enabled
  endpoint would both strain the non-commercial licence and contaminate the benchmark for everyone
  downstream who uses it afterwards. Paid, no-train endpoints are used for every vendor, and the
  retention setting used for each is recorded in the benchmark report's provenance table.

The one place consented recording would arise is the demo video, which uses our own voice.

## Privacy

**Where audio goes.** The microphone is live only while a command is being recorded — it is opened on
demand and the command ends on silence, so there is no always-listening mode and no wake word. Audio
goes from the browser to a server the user runs themselves, and from there to Intron for
transcription. It is not written to disk on the live path and not sent anywhere else.

**What the server holds.** Aalto's server holds the user's Intron, Gemini and Todoist credentials. It
is therefore treated as sensitive rather than as a local convenience:

- The API is gated by a shared-secret header and a CORS origin allowlist. Without this, anything able
  to reach the port could spend the user's API credits and write to their Todoist — which matters the
  moment the laptop is on a network the user does not control.
- Credentials live in a git-ignored `.env`; none are committed, and startup fails fast rather than
  running half-configured.
- Nothing about the user's identity is sent to any provider. No account identifiers, no email.

**Form contents.** Values spoken into a form are written into the form the user has open and nowhere
else. Aalto does not log, store or transmit what was typed into a civic form. Open tab titles *are*
sent to the planner as context, so that "switch to my Gmail tab" resolves to a real tab — that is a
deliberate, disclosed trade-off, and it is limited to titles and URLs of open tabs, capped at 20.

**Third parties.** Transcription goes to Intron, planning and summarising to Google, and during
benchmarking only, audio also goes to AssemblyAI and Google. Each retains data under its own policy.
A production deployment for genuinely sensitive civic intake would need this narrowed to a single
provider under contract, and we would not claim otherwise.

## Bias awareness

This is the part of the project we have spent the most effort on, because a speech product for
code-switched African languages that does not measure its own failures is making a promise it has not
checked.

**Aggregate accuracy hides the failure that matters.** A model can post a respectable overall word
error rate while systematically mangling the embedded English in an otherwise-Yoruba sentence. The
AfriSwitch authors say this explicitly, note that their released tags would support measuring it, and
do not report it. Our benchmark does: it uses the gold `[[EN]]` span tags to report error rate on
matrix-language tokens and English tokens separately, error rate *at the switch points themselves*
versus away from them, and how often an embedded English phrase is dropped wholesale.

**Per-language, never blended.** Results are reported per language with confidence intervals, and the
headline average is a macro-average that weights every language equally. A corpus-weighted average
would let two well-served languages hide failures in twelve others, which is the opposite of what a
fairness claim needs.

**Language coverage is reported as a result, not hidden.** Of AfriSwitch's 14 languages, AssemblyAI
documents support for 7. Publishing a 14-language average that includes seven languages a vendor
never claimed would be a rigged comparison. The headline is a CORE set — languages every evaluated
vendor claims — and unsupported cells are shaded, footnoted and excluded from every average and
significance test. Coverage itself is a row in the table, because for a civic-access product "which
languages does it serve at all" is a real finding.

**Orthographic bias is tested, not asserted.** The corpus publisher also makes one of the systems we
evaluate. The sharpest form of that concern is not training contamination — AfriSwitch is
evaluation-only — but that the *reference spelling* is that publisher's house style: their annotators
decided where Yoruba tone marks and Igbo hyphens go. A model from the same organisation would match
those conventions by construction, independently of whether it misheard anything. We cannot eliminate
that. We test it, by scoring under three normalisation regimes of increasing severity and reporting
whether the ranking survives. The benchmark report states this, and states the two related risks we
*cannot* address, before it shows any result.

**Known limitations, stated up front.** Numeral normalisation is applied to English number words
only — Yoruba's vigesimal system is out of scope, which is symmetric across systems but leaves
residual variance. Whitespace tokenisation understates errors for agglutinative Bantu languages,
where one written word carries several morphemes. Diacritic-insensitive scoring is meaningless for
Amharic, which uses a syllabary, so that comparison is marked not-applicable rather than fudged.

## Respect for user dignity

**The agent asks rather than guesses, wherever guessing is unrecoverable.** This is enforced in code,
not aspiration:

- A spoken description matching two Todoist tasks returns *"did you mean X, or Y?"* rather than
  closing one. Completing the wrong task is not something a user can undo in the moment.
- A radio button whose options do not match what was said is left untouched and reported, with the
  available options named. The original implementation selected the first option and *then* returned
  failure — silently putting a wrong answer into a civic form. Fixing that was the first change made
  to the form script, because a form that quietly misreports someone's circumstances to a government
  body is a worse outcome than a form that does not get filled.

**Submission stays a deliberate act.** Filling fields and submitting a form are separate tools. Aalto
never submits a form as a side effect of filling it.

**A choice of modality, not a replacement for agency.** The point is that someone can speak instead of
typing if that is easier — not that a machine completes civic paperwork on their behalf while they
watch. Everything Aalto does is visible: the transcript it heard is shown back, every task is listed
with its outcome, and failures are reported in plain language rather than swallowed.

**Speaking back is optional.** The mute control exists because a spoken reply is not always welcome —
in an office, a clinic waiting room, a queue. Muting skips text-to-speech generation entirely rather
than producing audio and discarding it, so the written answer still appears and nothing is spoken
aloud that the user did not ask to hear.

## What we would need before this touched real applicants

Stated plainly, because a hackathon prototype claiming civic readiness would itself be an ethics
problem:

- A review step showing every filled field before submission, with per-field correction by voice.
- Transcription under contract with one provider, with data residency and retention terms
  appropriate to government intake — not three vendors under their public terms.
- Accuracy measured on the specific forms and the specific population, not only on a research corpus.
- A path for a user to reach a human when the agent cannot help, since a civic process that can only
  be completed through a working speech model has replaced one exclusion with another.
