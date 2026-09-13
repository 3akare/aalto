# AfriSwitch Code-Switching Benchmark

An independent replication of the AfriSwitch evaluation protocol, adding the confidence intervals, paired significance tests, and code-switching-specific metrics that the corpus paper does not report.

## T0 · Provenance

| Field | Value |
| --- | --- |
| Dataset | `intronhealth/AfriSwitchCare` (single `test` split, evaluation-only) |
| Dataset commit | `see-manifest-note` |
| Sampling seed | `aalto-afriswitch-v1` |
| Tier | main (100 utterances/language) |
| Manifest frozen | 2026-09-13T12:56:00.453Z |
| Run completed | 2026-09-13T13:59:53.862Z |
| Utterances scored | 0 of 21 (complete cases) |
| Languages | 0 (CORE set: 0) |
| Exclusions | {"tooLong":86,"emptyTranscription":0,"tooFewTokens":0,"malformedTags":0,"truncatedDecode":1} |

| System | Model pinned |
| --- | --- |
| Intron Sahara STT (streaming) | `sahara-stt-stream` |
| AssemblyAI Universal-3.5 Pro | `universal-3-5-pro` |
| Google gemini-3.5-transcribe (dedicated ASR) | `gemini-3.5-transcribe` |
| Google gemini-3.8-flash (generalist multimodal) | `gemini-3.8-flash` |

> Selection is by deterministic content hash of `seed|language|filename`, not a seeded PRNG over row order — reproducible from the seed alone and independently verifiable with `sha256sum`. The manifest was committed **before** any API call was made; that commit timestamp is the pre-registration record.

## T1 · Conflict of interest and independence

AfriSwitch was created and published by Intron Health, which also develops Sahara STT, one of the systems evaluated here. AfriSwitch is distributed as a single evaluation-only `test` split with no training partition, and the AfriSwitch paper states all systems were evaluated zero-shot. We take that at face value but note it is not independently verifiable, and we identify three residual risks that a test-only split does not eliminate:

1. Internal model selection against this benchmark during Sahara's development.
2. Overlap between AfriSwitch's recording pipeline and Intron's training data.
3. **Reference orthography and transcription conventions defined by Intron's own annotators**, which may favour a model trained on similarly-transcribed data independently of acoustic accuracy.

We address (3) directly by scoring under three normalisation regimes of increasing severity and testing whether the model ranking is invariant — see T5. We cannot address (1) or (2) with the resources available and do not claim to have.

## T2 · Fairness protocol

| Asymmetry | How equalised | Residual risk |
| --- | --- | --- |
| Language coverage | CORE set = languages every vendor claims; unsupported cells excluded from all averages and tests | Coverage differs by vendor and is reported as its own result |
| Language conditioning | Matrix language supplied to every system through its own documented parameter | Vendors expose different interfaces; exact parameters in the appendix |
| Post-processing | Raw-ASR condition for all: Intron `use_disable_llm_corrections=TRUE`, AssemblyAI `punctuate`/`format_text` false, Gemini transcription mode `verbatim` | Gemini may apply corrections not exposed by the verbatim flag |
| Audio | Decoded once to 16 kHz mono PCM16 WAV (the corpus's native rate — no resampling); byte-identical bytes to every vendor, SHA-256 recorded | None known |
| Retries | One policy for all: max 2, only on 429/5xx/timeout, never on 4xx; retries counted and reported | — |
| Failures | Primary tables on the complete-case intersection | Drop-out sensitivity reported in T7 |
| Scheduling | Round-robin by utterance, so an incident hits every system equally | — |
| Scoring code | No provider-conditional logic — verify with `grep -riE 'intron\|assembly\|gemini\|sahara' src/benchmark/{normalize,align,metrics,stats}.ts` (no matches) | — |

## T3 · Headline — CORE-0 corpus WER

| System | Track A (diacritic-sensitive) | Track B (diacritic-insensitive) | Diacritic tax | Macro-avg (A) | Coverage |
| --- | --- | --- | --- | --- | --- |
| Intron Sahara STT (streaming) | 0.00% [n/a, n/a] | 0.00% [n/a, n/a] | 0.00% | n/a | 0/0 |
| AssemblyAI Universal-3.5 Pro | 0.00% [n/a, n/a] | 0.00% [n/a, n/a] | 0.00% | n/a | 0/0 |
| Google gemini-3.5-transcribe (dedicated ASR) | 0.00% [n/a, n/a] | 0.00% [n/a, n/a] | 0.00% | n/a | 0/0 |
| Google gemini-3.8-flash (generalist multimodal) | 0.00% [n/a, n/a] | 0.00% [n/a, n/a] | 0.00% | n/a | 0/0 |

> **Diacritic tax** = Track A WER − Track B WER: how much of a system's apparent error is orthographic convention rather than recognition. A near-zero tax for one vendor while others pay 8–15 points would quantify a house-style advantage rather than merely suspecting one.

## T4 · Paired differences

| A | B | ΔWER (A − B) | 95% paired CI | p (permutation) | p (Holm) | A wins | B wins | Ties |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Intron Sahara STT (streaming) | AssemblyAI Universal-3.5 Pro | 0.00% | [0.00%, 0.00%] | 1.0000 | 1.0000 | 0 | 0 | 0 |
| Intron Sahara STT (streaming) | Google gemini-3.5-transcribe (dedicated ASR) | 0.00% | [0.00%, 0.00%] | 1.0000 | 1.0000 | 0 | 0 | 0 |
| Intron Sahara STT (streaming) | Google gemini-3.8-flash (generalist multimodal) | 0.00% | [0.00%, 0.00%] | 1.0000 | 1.0000 | 0 | 0 | 0 |
| AssemblyAI Universal-3.5 Pro | Google gemini-3.5-transcribe (dedicated ASR) | 0.00% | [0.00%, 0.00%] | 1.0000 | 1.0000 | 0 | 0 | 0 |
| AssemblyAI Universal-3.5 Pro | Google gemini-3.8-flash (generalist multimodal) | 0.00% | [0.00%, 0.00%] | 1.0000 | 1.0000 | 0 | 0 | 0 |
| Google gemini-3.5-transcribe (dedicated ASR) | Google gemini-3.8-flash (generalist multimodal) | 0.00% | [0.00%, 0.00%] | 1.0000 | 1.0000 | 0 | 0 | 0 |

> **Overlapping confidence intervals in T3 do not imply the absence of a significant difference.** Every system transcribes the same audio, so utterance difficulty dominates the variance and cancels in the paired difference. Read this table, not the overlap in T3. The resampling unit is the utterance (never the word — errors within an utterance are strongly correlated). Holm–Bonferroni is applied within the family of pairwise tests on the pooled primary metric.

## T5 · Ranking stability across normalisation regimes

*This is the table that answers the publisher-bias question in T1.* Track A is the publisher's protocol; Track B removes diacritics; Track C additionally strips intra-word punctuation and collapses the digit/word axis. If the ranking holds across all three, house-style advantage is bounded.

| Comparison | Kendall's τ | Order (first) | Order (second) |
| --- | --- | --- | --- |
| A vs B | 1.000 | Intron Sahara STT (streaming) › AssemblyAI Universal-3.5 Pro › Google gemini-3.5-transcribe (dedicated ASR) › Google gemini-3.8-flash (generalist multimodal) | Intron Sahara STT (streaming) › AssemblyAI Universal-3.5 Pro › Google gemini-3.5-transcribe (dedicated ASR) › Google gemini-3.8-flash (generalist multimodal) |
| A vs C | 1.000 | Intron Sahara STT (streaming) › AssemblyAI Universal-3.5 Pro › Google gemini-3.5-transcribe (dedicated ASR) › Google gemini-3.8-flash (generalist multimodal) | Intron Sahara STT (streaming) › AssemblyAI Universal-3.5 Pro › Google gemini-3.5-transcribe (dedicated ASR) › Google gemini-3.8-flash (generalist multimodal) |
| B vs C | 1.000 | Intron Sahara STT (streaming) › AssemblyAI Universal-3.5 Pro › Google gemini-3.5-transcribe (dedicated ASR) › Google gemini-3.8-flash (generalist multimodal) | Intron Sahara STT (streaming) › AssemblyAI Universal-3.5 Pro › Google gemini-3.5-transcribe (dedicated ASR) › Google gemini-3.8-flash (generalist multimodal) |

## T6 · Code-switching metrics

These are point-of-interest metrics that the AfriSwitch corpus tags enable and which the corpus paper explicitly does not report. Reference language tags are gold, taken from the corpus's `transcription_tagged` column; hypothesis tags are projected through the word-level alignment.

| System | WER matrix | WER English | Ratio EN/matrix | SPER | non-SPER | Switch penalty Δ | EN spans deleted | CMI slope |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Intron Sahara STT (streaming) | 0.00% | 0.00% | n/a | 0.00% | 0.00% | 0.00% | 0.00% | 0.00000 |
| AssemblyAI Universal-3.5 Pro | 0.00% | 0.00% | n/a | 0.00% | 0.00% | 0.00% | 0.00% | 0.00000 |
| Google gemini-3.5-transcribe (dedicated ASR) | 0.00% | 0.00% | n/a | 0.00% | 0.00% | 0.00% | 0.00% | 0.00000 |
| Google gemini-3.8-flash (generalist multimodal) | 0.00% | 0.00% | n/a | 0.00% | 0.00% | 0.00% | 0.00% | 0.00000 |

> **Switch penalty Δ** = SPER − non-SPER, the extra error rate incurred at a language boundary specifically. It is the most code-switching-specific number here.
> **Ratio EN/matrix** diagnoses failure *mode*: a system that force-decodes everything into English shows a low ratio; one that drops the embedded English shows a high one.
> **CMI slope** is the length-weighted OLS slope of per-utterance WER on the corpus's own code-mixing index — how fast a system degrades as mixing intensifies, as distinct from simply being worse overall.

## T7 · Failures, retries and latency

| System | Hard failures | Retries | Empty transcripts | p50 latency | p95 latency |
| --- | --- | --- | --- | --- | --- |
| Intron Sahara STT (streaming) | 3 | 9 | 0 | n/a | n/a |
| AssemblyAI Universal-3.5 Pro | 0 | 0 | 0 | n/a | n/a |
| Google gemini-3.5-transcribe (dedicated ASR) | 0 | 0 | 0 | n/a | n/a |
| Google gemini-3.8-flash (generalist multimodal) | 21 | 57 | 0 | n/a | n/a |

> Latency from this pass is measured under concurrency and is therefore partly a measurement of our own queueing, not purely of vendor speed — the serial latency pass is the figure to cite. Batch-API latency is also a different construct from the streaming path the product actually uses, so these numbers are directional only.

## T8 · Per-language WER (Track A)

| Language | n | Intron Sahara STT (streaming) | AssemblyAI Universal-3.5 Pro | Google gemini-3.5-transcribe (dedicated ASR) | Google gemini-3.8-flash (generalist multimodal) |
| --- | --- | --- | --- | --- | --- |

¹ Vendor does not claim support for this language. Shown for completeness, excluded from all averages and all significance tests.

## T9 · Honest negative results and limitations

- Language coverage differs across vendors; the headline is a CORE-set comparison, and the EXT table is not a like-for-like average.
- Single-run vendor variance is not bounded unless the repeatability pass was run.
- Numeral canonicalisation is applied to English number words only; matrix-language numerals are scored as written. Symmetric across systems, but it leaves residual variance.
- Whitespace tokenisation understates errors for agglutinative Bantu languages (Zulu, Kinyarwanda, Luganda), where one orthographic word carries several morphemes — read CER alongside WER for those.
- Track B is a no-op for Amharic: Ge'ez is a syllabary with no combining marks, so the diacritic tax is undefined there.
- No streaming latency was measured; the product path uses streaming, the benchmark uses batch APIs.
- Orthographic house-style advantage is bounded by T5 but not eliminated.

---

_AfriSwitch is licensed CC-BY-NC-SA-4.0. Metrics and derived statistics are published here; the audio itself is not redistributed._
