# AfriSwitch Code-Switching Benchmark

> **This file is generated.** Running `npm run benchmark` from `server/` overwrites it with the real
> report. What follows describes what that report will contain and what is currently blocking it.

**Status: not yet run.** AfriSwitch is a manually gated dataset. Access has been requested and is
pending approval by Intron Health. The harness is written, tested and verified against all four
providers on synthetic audio; it needs only the corpus.

---

## What the generated report contains

Ordering is deliberate - provenance and fairness come before any result, because the criterion being
scored is the quality *and fairness* of the comparison, not the leaderboard.

| Table | Contents |
| --- | --- |
| T0 | Provenance: dataset commit, sampling seed, manifest hash, pre-registration commits, pinned model versions, per-vendor data-retention setting |
| T1 | Conflict of interest - the corpus publisher also makes one of the evaluated systems - and the three residual risks a test-only split does not remove |
| T2 | Fairness protocol: every cross-vendor asymmetry, how it was equalised, and the residual risk that remains |
| T3 | Headline CORE-set corpus WER with 95% bootstrap intervals, macro-average, diacritic tax, language coverage |
| T4 | Paired differences: ΔWER, paired CI, permutation *p*, Holm-adjusted *p*, win/loss/tie |
| T5 | **Ranking stability** across three normalisation regimes - the test for orthographic house-style bias |
| T6 | Code-switching metrics: class-conditional WER, switch-point error rate, switch penalty, English-span deletion, CMI slope |
| T7 | Failures, retries, empty transcripts, latency |
| T8 | Per-language WER, with unsupported vendor/language cells excluded from every average and test |
| T9 | Honest negative results and limitations |

## Systems evaluated

Four, against the rules' requirement of three or more including a Sahara API:

| System | Model | Role |
| --- | --- | --- |
| Intron Sahara | `sahara-stt` (streaming) | The Sahara API, and the Africa-specialist |
| AssemblyAI | `universal-3-5-pro` | Global commercial baseline |
| Google | `gemini-3.5-transcribe` | Dedicated ASR from a generalist vendor |
| Google | `gemini-3.8-flash` | Generalist multimodal LLM as a control |

Four systems spanning three genuinely different design philosophies - Africa-specialist, global
commercial, and generalist-LLM-as-ASR - which is a more interesting axis than four leaderboard entries.

## The thesis

The AfriSwitch paper evaluates these systems, reports point estimates only - no confidence intervals,
no significance tests - and explicitly declines to compute the point-of-interest metrics its own
`[[EN]]` span tags enable, while conceding that aggregate WER can mask "systematic failures on
embedded English words."

This report is an independent replication of that published protocol, adding exactly what it omits:
statistical rigour, and measurement at the switch points themselves.

## Method, in brief

**Sampling.** 100 utterances per language, equal allocation rather than proportional - Afrikaans has
~198 rows, so proportional sampling would leave its cell uninterpretable. Stratified by language, then
by duration tercile, then systematically sampled ordered by the corpus's own code-mixing index.
Selection is by deterministic content hash of `seed|language|filename`, reproducible from the seed
alone and verifiable with `sha256sum`. The manifest is committed before any API call; that commit
timestamp is the pre-registration record.

**Fairness.** One raw-ASR condition across all vendors (Intron `use_disable_llm_corrections`,
AssemblyAI `punctuate`/`format_text` off, Gemini transcription mode `verbatim`). Byte-identical 16 kHz
mono PCM16 audio to every system, decoded once, SHA-256 recorded. One retry policy, with retries
counted and reported. Round-robin by utterance so an incident hits everyone equally. Primary tables on
the complete-case intersection, because silently dropping failures rewards whichever model fails on
hard audio.

**Statistics.** Corpus WER as a ratio of sums, never a mean of per-utterance ratios. Stratified
percentile bootstrap resampling *utterances*, not words - errors within an utterance are strongly
correlated, and word-level resampling would produce absurdly tight intervals. Paired comparisons on
shared replicate indices, paired permutation tests, Holm-Bonferroni within declared families.

**Code-switching metrics** come from the corpus's gold `[[EN]]` tags projected onto hypotheses through
the word-level alignment - no language-ID model needed.

## Verifying the fairness claim

The scoring path contains no provider-conditional code. Check it:

```bash
grep -riE 'intron|assembly|gemini|sahara' server/src/benchmark/{normalize,align,metrics,stats}.ts
```

No matches.

## Reproducing it

```bash
cd server
npm run corpus -- main                      # build and freeze the sample
git add benchmark/manifest && git commit     # pre-registration, before any API call
npm run benchmark -- main
```
