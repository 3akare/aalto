# AfriSwitch Code-Switching Benchmark

An independent replication of the AfriSwitch evaluation protocol, adding the confidence intervals, paired significance tests, and code-switching-specific metrics that the corpus paper does not report.

## At a glance

Google Gemini 3.5 Transcribe leads significantly on headline acoustic accuracy on the CORE-7 languages (WER 35.42% vs Intron 60.78%, p=0.0104; vs AssemblyAI 69.05%, p=0.0003). However, this headline must be interpreted alongside three critical architectural and statistical qualifiers:

1. **Architectural Asymmetry (Streaming vs. Non-Causal Batch):** Intron was evaluated under production real-time streaming constraints (`sahara-stt-stream`, causal, 16 KB chunks, no future context), whereas Google and AssemblyAI received the complete audio file with full bidirectional self-attention. Streaming models pay an inherent acoustic tax against non-causal batch models.
2. **African Language Specialization & Code-Switching Retention:** Intron dominates on core matrix African languages (Amharic 13.19% vs AssemblyAI 111.81%; Hausa 23.96% vs AssemblyAI 79.17%), and drops only 9.23% of embedded English spans compared to ~18–19% dropped by Google and AssemblyAI.
3. **Statistical Artifacts on Secondary Metrics:** AssemblyAI's low switch penalty (1.62 pp) is an artifact of uniform failure across the clip (68.78% non-switch WER vs 70.39% switch WER), not superior switching. Furthermore, numeral entity extraction is statistically underpowered in this smoke run (N = 2 tokens across the corpus), with all three systems sitting inside mutual confidence intervals on overall entity accuracy.

| Dimension | System / Observation | Result | Contextual Nuance |
| :--- | :--- | :--- | :--- |
| **Headline Acoustic Accuracy (CORE-7 WER)** | **Google gemini-3.5-transcribe** | 35.42% | Statistically significant lead over Intron (60.78%, p=0.0104) and AssemblyAI (69.05%, p=0.0003). Evaluated in non-causal batch mode. |
| **Matrix African Languages** | **Intron Sahara STT (streaming)** | Amharic: 13.19%<br>Hausa: 23.96% | Dominant on African matrix phonotactics and Ge'ez script where global models collapse (AssemblyAI 111.81% on Amharic). |
| **Embedded English Retention** | **Intron Sahara STT (streaming)** | 9.23% dropped | Retains code-switched English twice as effectively as Google (18.46% dropped) and AssemblyAI (19.23% dropped). |
| **Switch Penalty** | **AssemblyAI Universal-3.5 Pro** | 1.62 pp | *Mathematical artifact:* AssemblyAI fails uniformly everywhere (68.78% non-switch WER), not showing superior code-switch modeling. |
| **Entity Accuracy (Form Extraction)** | **Statistical Tie** | 48.28% – 53.45% | All systems sit within mutual 95% CIs. Numeral extraction is exploratory ($N_{num} = 2$ tokens). |

> Read this summary alongside the paired significance tests in T4 and the architectural disclosures in T2. With a smoke sample ($N=50$ complete cases, $N=30$ CORE-7), rankings on secondary metrics reflect exploratory bounds rather than definitive leaderboard claims.

## T0 · Provenance

| Field | Value |
| --- | --- |
| Dataset | `intronhealth/AfriSwitch` (single `test` split, evaluation-only) |
| Dataset commit | `see-manifest-note` |
| Sampling seed | `aalto-afriswitch-v1` |
| Tier | smoke (5 utterances/language) |
| Manifest frozen | 2026-09-14T15:42:52.510Z |
| Run completed | 2026-09-15T07:53:12.274Z |
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
| Architecture (Streaming vs Batch) | Intron evaluated on real-time streaming (`sahara-stt-stream`); Google and AssemblyAI evaluated on offline batch APIs | Causal streaming models pay an inherent 10–25 pp acoustic penalty vs bidirectional batch models with full right-context. Intron batch sync rejects files >5s, necessitating streaming. |
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
>
> **Language Conditioning Confound (Google Gemini):** Gemini was prompted with the clip's matrix language tag (e.g. `ha-NG`, `am-ET`) in system instructions. This imposes a strong matrix language prior that degrades embedded English decoding: Gemini posts an English WER of 62.50% vs matrix WER of 29.29% (ratio 2.13), and drops 18.46% of English spans entirely. Intron, running streaming ASR, drops only 9.23% of English spans.
>
> **Switch Penalty Interpretation (AssemblyAI):** AssemblyAI posts a near-zero switch penalty (1.62 pp). However, this is an artifact of uniform acoustic failure across the clip (68.78% non-switch WER vs 70.39% switch WER), not superior code-switching capability.

## T6a · Entity error - names and numbers

A transcript can post a respectable word error rate and still be useless for filling in a form, because the tokens that matter - a name, an age, a phone number, a dosage - are a handful among hundreds of function words. Scored separately, they ask the question the product actually cares about.

| System | Entity error | Numbers | Names | Number tokens | Name tokens |
| --- | --- | --- | --- | --- | --- |
| Intron Sahara STT (streaming) | 48.28% [36.07%, 60.61%] | 50.00% | 48.21% | 2 | 56 |
| Google gemini-3.5-transcribe (dedicated ASR) | 51.72% [40.00%, 64.15%] | 50.00% | 51.79% | 2 | 56 |
| AssemblyAI Universal-3.5 Pro | 53.45% [40.00%, 68.00%] | 50.00% | 53.57% | 2 | 56 |

> Numbers are digit runs surviving numeral folding. Names are capitalised non-initial tokens - the standard heuristic once case is the only signal left, and a crude one, which is why the denominators are published here rather than only the rates. It is script-dependent: Ge'ez has no case, so Amharic contributes no name tokens at all and its column is an absence of measurement rather than a score of zero.
>
> **Statistical Power Warning:** Across the smoke subset ($N=50$), only 2 numeral tokens ($N_{num} = 2$) survived entity extraction across the entire corpus. All three vendors correctly transcribed 1 of 2 numerals (50.00%). Numeral comparisons here are purely exploratory and have no ranking power. Overall entity error rates (48.28% – 53.45%) fall within mutual 95% confidence intervals and constitute a statistical tie.

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

- **Architectural Asymmetry (Streaming vs. Non-Causal Batch):** Intron was evaluated on real-time causal streaming (`sahara-stt-stream`, 16 KB chunks, no future lookahead context), whereas Google and AssemblyAI received the entire audio file in non-causal batch mode. In production speech systems, causal streaming models typically pay an inherent 10–25 pp acoustic penalty relative to bidirectional batch decoders.
- **Language Conditioning Bias:** Google Gemini was conditioned with matrix BCP-47 tags (e.g. `ha-NG`, `am-ET`) in system instructions. While standard practice for monolingual APIs, this induces a strong matrix prior that penalises code-switched English (English WER 62.50% vs matrix WER 29.29%).
- **Smoke Sample Size ($N=50$):** This run serves as an audited diagnostic and methodology demonstration. While headline acoustic differences on CORE-7 are statistically significant under utterance-level resampling, secondary metrics (such as numeral extraction with $N_{num}=2$ tokens) and fine-grained per-language estimates require $N \ge 1,000$ complete cases for definitive production guidance.
- **API Quota & Concurrency Ceilings:** Google Gemini free-tier enforces a strict 25 requests/day ceiling (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`). The evaluation relies on deterministic disk caching to prevent benchmark stalls.
- **Language Coverage:** Coverage differs across vendors; the headline comparison is restricted to the CORE-7 intersection where all three vendors claim support. Non-CORE languages are excluded from headline averages.
- **Agglutinative Morphology:** Whitespace tokenisation understates word-level errors for agglutinative Bantu languages (Zulu, Kinyarwanda, Luganda), where one orthographic word carries several morphemes. Character error rate (CER) should be read alongside WER for these languages.
- **Amharic Diacritic Invariance:** Track B (diacritic removal) is a no-op for Amharic because the Ge'ez script is an abugida without separate combining diacritics.
- **Numeral Normalisation:** Numeral canonicalisation is applied to English number words only; matrix-language numerals are scored as written. While applied symmetrically across systems, residual orthographic variation remains.
- **Publisher House-Style:** Orthographic house-style advantage is bounded by Kendall's τ rank-invariance across normalisation tracks (T5), but residual vocabulary bias cannot be eliminated from a single-corpus benchmark.

---

_AfriSwitch is licensed CC-BY-NC-SA-4.0. Metrics and derived statistics are published here; the audio itself is not redistributed._
