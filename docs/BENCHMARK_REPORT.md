# AfriSwitch Code-Switching Benchmark

An independent replication of the AfriSwitch evaluation protocol, adding the confidence intervals, paired significance tests, and code-switching-specific metrics that the corpus paper does not report.

## At a glance

| Metric | Best system | Result | Rank | Next best |
| --- | --- | --- | --- | --- |
| Corpus WER (Track A) | **Google gemini-3.5-transcribe (dedicated ASR)** | 35.42% | 1st of 3 | Intron Sahara STT (streaming) 60.78% |
| Entity error (names + numbers) | **Intron Sahara STT (streaming)** | 48.28% | 1st of 3 | Google gemini-3.5-transcribe (dedicated ASR) 51.72% |
| Error on embedded English | **Intron Sahara STT (streaming)** | 56.25% | 1st of 3 | Google gemini-3.5-transcribe (dedicated ASR) 62.50% |
| Switch penalty | **AssemblyAI Universal-3.5 Pro** | 1.62% | 1st of 3 | Google gemini-3.5-transcribe (dedicated ASR) 20.73% |
| English spans dropped | **Intron Sahara STT (streaming)** | 9.23% | 1st of 3 | Google gemini-3.5-transcribe (dedicated ASR) 18.46% |

> Read this table alongside T4. With a sample this size several of these margins are inside the confidence intervals, and a rank of 1st is not the same claim as a significant difference.

## T0 · Provenance

| Field | Value |
| --- | --- |
| Dataset | `intronhealth/AfriSwitch` (single `test` split, evaluation-only) |
| Dataset commit | `see-manifest-note` |
| Sampling seed | `aalto-afriswitch-v1` |
| Tier | smoke (5 utterances/language) |
| Manifest frozen | 2026-09-14T15:42:52.510Z |
| Run completed | 2026-09-15T07:26:14.560Z |
| Utterances scored | 50 of 66 (complete cases) |
| Languages | 13 (CORE set: 7) |
| Exclusions | {"tooLong":0,"emptyTranscription":0,"tooFewTokens":38,"malformedTags":10,"truncatedDecode":1} |

| System | Model pinned |
| --- | --- |
| Intron Sahara STT (streaming) | `sahara-stt-stream` |
| AssemblyAI Universal-3.5 Pro | `universal-3-5-pro` |
| Google gemini-3.5-transcribe (dedicated ASR) | `gemini-3.5-transcribe` |

> Selection is by deterministic content hash of `seed|language|filename`, not a seeded PRNG over row order - reproducible from the seed alone and independently verifiable with `sha256sum`. The manifest was committed **before** any API call was made; that commit timestamp is the pre-registration record.

## T1 · Conflict of interest and independence

AfriSwitch was created and published by Intron Health, which also develops Sahara STT, one of the systems evaluated here. AfriSwitch is distributed as a single evaluation-only `test` split with no training partition, and the AfriSwitch paper states all systems were evaluated zero-shot. We take that at face value but note it is not independently verifiable, and we identify three residual risks that a test-only split does not eliminate:

1. Internal model selection against this benchmark during Sahara's development.
2. Overlap between AfriSwitch's recording pipeline and Intron's training data.
3. **Reference orthography and transcription conventions defined by Intron's own annotators**, which may favour a model trained on similarly-transcribed data independently of acoustic accuracy.

We address (3) directly by scoring under three normalisation regimes of increasing severity and testing whether the model ranking is invariant - see T5. We cannot address (1) or (2) with the resources available and do not claim to have.

## T2 · Fairness protocol

| Asymmetry | How equalised | Residual risk |
| --- | --- | --- |
| Language coverage | CORE set = languages every vendor claims; unsupported cells excluded from all averages and tests | Coverage differs by vendor and is reported as its own result |
| Language conditioning | Matrix language supplied to every system through its own documented parameter | Vendors expose different interfaces; exact parameters in the appendix |
| Post-processing | Raw-ASR condition for all: Intron `use_disable_llm_corrections=TRUE`, AssemblyAI `punctuate`/`format_text` false, Gemini transcription mode `verbatim` | Gemini may apply corrections not exposed by the verbatim flag |
| Audio | Decoded once to 16 kHz mono PCM16 WAV (the corpus's native rate - no resampling); byte-identical bytes to every vendor, SHA-256 recorded | None known |
| Retries | One policy for all: max 2, only on 429/5xx/timeout, never on 4xx; retries counted and reported | - |
| Failures | Primary tables on the complete-case intersection | Drop-out sensitivity reported in T7 |
| Scheduling | Round-robin by utterance, so an incident hits every system equally | - |
| Scoring code | No provider-conditional logic - verify with `grep -riE 'intron\|assembly\|gemini\|sahara' src/benchmark/{normalize,align,metrics,stats}.ts` (no matches) | - |

## T3 · Headline - CORE-7 corpus WER

| System | Track A (diacritic-sensitive) | Track B (diacritic-insensitive) | Diacritic tax | Macro-avg (A) | Coverage |
| --- | --- | --- | --- | --- | --- |
| Google gemini-3.5-transcribe (dedicated ASR) | 35.42% [29.12%, 42.50%] | 33.41% [27.24%, 40.42%] | 2.01% | 38.59% | 10/13 |
| Intron Sahara STT (streaming) | 60.78% [46.86%, 75.96%] | 56.42% [43.38%, 70.75%] | 4.36% | 62.42% | 13/13 |
| AssemblyAI Universal-3.5 Pro | 69.05% [61.94%, 76.64%] | 68.72% [61.66%, 76.25%] | 0.34% | 72.70% | 7/13 |

> **Diacritic tax** = Track A WER - Track B WER: how much of a system's apparent error is orthographic convention rather than recognition. A near-zero tax for one vendor while others pay 8-15 points would quantify a house-style advantage rather than merely suspecting one.

## T4 · Paired differences

| A | B | ΔWER (A - B) | 95% paired CI | p (permutation) | p (Holm) | A wins | B wins | Ties |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Intron Sahara STT (streaming) | AssemblyAI Universal-3.5 Pro | -8.27% | [-24.05%, 7.94%] | 0.5518 | 0.5518 | 16 | 12 | 2 |
| Intron Sahara STT (streaming) | Google gemini-3.5-transcribe (dedicated ASR) | 25.36% | [12.57%, 39.36%] | 0.0052 | 0.0104 | 8 | 17 | 5 |
| AssemblyAI Universal-3.5 Pro | Google gemini-3.5-transcribe (dedicated ASR) | 33.63% | [25.24%, 41.77%] | 0.0001 | 0.0003 | 2 | 26 | 2 |

> **Overlapping confidence intervals in T3 do not imply the absence of a significant difference.** Every system transcribes the same audio, so utterance difficulty dominates the variance and cancels in the paired difference. Read this table, not the overlap in T3. The resampling unit is the utterance (never the word - errors within an utterance are strongly correlated). Holm-Bonferroni is applied within the family of pairwise tests on the pooled primary metric.

## T5 · Ranking stability across normalisation regimes

*This is the table that answers the publisher-bias question in T1.* Track A is the publisher's protocol; Track B removes diacritics; Track C additionally strips intra-word punctuation and collapses the digit/word axis. If the ranking holds across all three, house-style advantage is bounded.

| Comparison | Kendall's τ | Order (first) | Order (second) |
| --- | --- | --- | --- |
| A vs B | 1.000 | Google gemini-3.5-transcribe (dedicated ASR) › Intron Sahara STT (streaming) › AssemblyAI Universal-3.5 Pro | Google gemini-3.5-transcribe (dedicated ASR) › Intron Sahara STT (streaming) › AssemblyAI Universal-3.5 Pro |
| A vs C | 1.000 | Google gemini-3.5-transcribe (dedicated ASR) › Intron Sahara STT (streaming) › AssemblyAI Universal-3.5 Pro | Google gemini-3.5-transcribe (dedicated ASR) › Intron Sahara STT (streaming) › AssemblyAI Universal-3.5 Pro |
| B vs C | 1.000 | Google gemini-3.5-transcribe (dedicated ASR) › Intron Sahara STT (streaming) › AssemblyAI Universal-3.5 Pro | Google gemini-3.5-transcribe (dedicated ASR) › Intron Sahara STT (streaming) › AssemblyAI Universal-3.5 Pro |

## T6 · Code-switching metrics

These are point-of-interest metrics that the AfriSwitch corpus tags enable and which the corpus paper explicitly does not report. Reference language tags are gold, taken from the corpus's `transcription_tagged` column; hypothesis tags are projected through the word-level alignment.

| System | WER matrix | WER English | Ratio EN/matrix | SPER | non-SPER | Switch penalty Δ | EN spans deleted | CMI slope |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Intron Sahara STT (streaming) | 60.05% | 56.25% | 0.94 | 79.61% | 56.93% | 22.67% | 9.23% | 0.00150 |
| AssemblyAI Universal-3.5 Pro | 68.44% | 69.44% | 1.01 | 70.39% | 68.78% | 1.62% | 19.23% | 0.00493 |
| Google gemini-3.5-transcribe (dedicated ASR) | 29.29% | 62.50% | 2.13 | 52.63% | 31.90% | 20.73% | 18.46% | 0.00831 |

> **Switch penalty Δ** = SPER - non-SPER, the extra error rate incurred at a language boundary specifically. It is the most code-switching-specific number here.
> **Ratio EN/matrix** diagnoses failure *mode*: a system that force-decodes everything into English shows a low ratio; one that drops the embedded English shows a high one.
> **CMI slope** is the length-weighted OLS slope of per-utterance WER on the corpus's own code-mixing index - how fast a system degrades as mixing intensifies, as distinct from simply being worse overall.

## T6a · Entity error - names and numbers

A transcript can post a respectable word error rate and still be useless for filling in a form, because the tokens that matter - a name, an age, a phone number, a dosage - are a handful among hundreds of function words. Scored separately, they ask the question the product actually cares about.

| System | Entity error | Numbers | Names | Number tokens | Name tokens |
| --- | --- | --- | --- | --- | --- |
| Intron Sahara STT (streaming) | 48.28% [36.07%, 60.61%] | 50.00% | 48.21% | 2 | 56 |
| Google gemini-3.5-transcribe (dedicated ASR) | 51.72% [40.00%, 64.15%] | 50.00% | 51.79% | 2 | 56 |
| AssemblyAI Universal-3.5 Pro | 53.45% [40.00%, 68.00%] | 50.00% | 53.57% | 2 | 56 |

> Numbers are digit runs surviving numeral folding. Names are capitalised non-initial tokens - the standard heuristic once case is the only signal left, and a crude one, which is why the denominators are published here rather than only the rates. It is script-dependent: Ge'ez has no case, so Amharic contributes no name tokens at all and its column is an absence of measurement rather than a score of zero.

## T7 · Failures, retries and latency

| System | Hard failures | Retries | Empty transcripts | p50 latency | p95 latency |
| --- | --- | --- | --- | --- | --- |
| Intron Sahara STT (streaming) | 7 | 70 | 0 | 10794 ms | 20960 ms |
| AssemblyAI Universal-3.5 Pro | 0 | 6 | 0 | 5374 ms | 16744 ms |
| Google gemini-3.5-transcribe (dedicated ASR) | 9 | 40 | 0 | 4245 ms | 10050 ms |

> Latency from this pass is measured under concurrency and is therefore partly a measurement of our own queueing, not purely of vendor speed - the serial latency pass is the figure to cite. Batch-API latency is also a different construct from the streaming path the product actually uses, so these numbers are directional only.

## T8 · Per-language WER (Track A)

| Language | n | Intron Sahara STT (streaming) | AssemblyAI Universal-3.5 Pro | Google gemini-3.5-transcribe (dedicated ASR) |
| --- | --- | --- | --- | --- |
| `af` | 5 | 54.41% [24.56%, 86.33%] | 55.15% [36.17%, 81.60%] | 37.50% [15.43%, 78.57%] |
| `am` | 5 | 13.19% [4.84%, 25.62%] | 111.81% [100.00%, 135.17%] | 27.08% [20.12%, 35.42%] |
| `fr` | 4 | 78.53% [23.08%, 141.43%] | 6.75% [4.69%, 8.08%] | 6.75% [5.56%, 9.48%] |
| `ha` | 4 | 23.96% [12.87%, 32.56%] | 79.17% [67.44%, 94.59%] | 31.25% [13.92%, 48.84%] |
| `ig` | 3 | 42.11% [21.62%, 100.00%] | - ¹ | 35.09% [0.00%, 106.25%] |
| `lg` | 2 | 56.00% [18.75%, 122.22%] | - ¹ | 88.00% [55.56%, 106.25%] |
| `om` | 1 | 82.61% [82.61%, 82.61%] | - ¹ | - ¹ |
| `pcm` | 5 | 54.26% [22.55%, 119.80%] | - ¹ | - ¹ |
| `rw` | 4 | 66.39% [32.56%, 96.61%] | - ¹ | 56.30% [25.00%, 74.67%] |
| `sn` | 4 | 116.46% [91.11%, 150.03%] | 100.00% [88.89%, 120.34%] | 77.22% [59.26%, 87.50%] |
| `sw` | 3 | 42.45% [0.00%, 64.86%] | 63.31% [50.00%, 77.97%] | 35.97% [16.67%, 48.65%] |
| `tn` | 5 | 106.90% [65.19%, 200.00%] | - ¹ | - ¹ |
| `yo` | 5 | 107.97% [81.74%, 133.92%] | 92.75% [84.82%, 99.33%] | 54.35% [41.78%, 67.52%] |

¹ Vendor does not claim support for this language. Shown for completeness, excluded from all averages and all significance tests.

## T9 · Honest negative results and limitations

- Language coverage differs across vendors; the headline is a CORE-set comparison, and the EXT table is not a like-for-like average.
- Single-run vendor variance is not bounded unless the repeatability pass was run.
- Numeral canonicalisation is applied to English number words only; matrix-language numerals are scored as written. Symmetric across systems, but it leaves residual variance.
- Whitespace tokenisation understates errors for agglutinative Bantu languages (Zulu, Kinyarwanda, Luganda), where one orthographic word carries several morphemes - read CER alongside WER for those.
- Track B is a no-op for Amharic: Ge'ez is a syllabary with no combining marks, so the diacritic tax is undefined there.
- No streaming latency was measured; the product path uses streaming, the benchmark uses batch APIs.
- Orthographic house-style advantage is bounded by T5 but not eliminated.

---

_AfriSwitch is licensed CC-BY-NC-SA-4.0. Metrics and derived statistics are published here; the audio itself is not redistributed._
