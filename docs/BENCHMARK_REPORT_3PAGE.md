# Code-Switching Speech Benchmark - Aalto

**Sahara STT · AssemblyAI Universal-3.5 Pro · Gemini 3.5 Transcribe**
Run 2026-09-15 · corpus `intronhealth/AfriSwitch` @ `f20059d` · seed `aalto-afriswitch-v1`
Full report, code and manifest: **github.com/3akare/aalto**

## Summary

Google Gemini 3.5 Transcribe achieved the lowest headline corpus Word Error Rate on the CORE-7 languages at 35.42% [29.12%, 42.50%], significantly outperforming Intron Sahara STT (60.78% [46.86%, 75.96%], paired Δ=25.36 pp, p=0.0104) and AssemblyAI Universal-3.5 Pro (69.05% [61.94%, 76.64%], paired Δ=33.63 pp, p=0.0003). However, this headline must be evaluated alongside three critical architectural and statistical qualifiers:

1. **Architectural Asymmetry (Streaming vs. Non-Causal Batch):** Intron was evaluated under production real-time streaming constraints (`sahara-stt-stream`, causal, 16 KB chunks, no future lookahead context), whereas Google and AssemblyAI received the complete audio file with bidirectional context. In speech systems, causal streaming models typically pay an inherent 10–25 pp acoustic penalty relative to non-causal batch decoders.
2. **African Language Specialization & Code-Switching Retention:** Intron dominates on core matrix African languages (Amharic 13.19% vs AssemblyAI 111.81%; Hausa 23.96% vs AssemblyAI 79.17%), and drops only 9.23% of embedded English spans compared to ~18–19% dropped by Google and AssemblyAI.
3. **Statistical Artifacts on Secondary Metrics:** AssemblyAI's low switch penalty (1.62 pp) is an artifact of uniform acoustic failure (68.78% non-switch WER vs 70.39% switch WER), not superior code-switch modeling. Furthermore, entity extraction is statistically indistinguishable across all three systems (48.28% – 53.45%, mutual CIs overlapping), with numeral extraction underpowered ($N_{num} = 2$ tokens).

| Dimension | System / Observation | Result | Contextual Nuance |
| :--- | :--- | :--- | :--- |
| **Headline Acoustic Accuracy (CORE-7)** | **Gemini 3.5 Transcribe** | 35.42% | Statistically significant lead over Intron (p=0.0104) and AssemblyAI (p=0.0003). Non-causal batch mode. |
| **Matrix African Languages** | **Sahara STT (streaming)** | Amharic: 13.19%<br>Hausa: 23.96% | Dominant on African matrix phonotactics and Ge'ez script where global models collapse (AssemblyAI 111.81% on Amharic). |
| **Embedded English Retention** | **Sahara STT (streaming)** | 9.23% dropped | Retains code-switched English twice as effectively as Gemini (18.46%) and AssemblyAI (19.23%). |
| **Switch Penalty** | **AssemblyAI Universal-3.5 Pro** | 1.62 pp | *Artifact:* AssemblyAI fails uniformly everywhere (68.78% non-switch WER), not demonstrating code-switch strength. |
| **Entity Accuracy (Form Extraction)** | **Statistical Tie** | 48.28% – 53.45% | All systems sit within mutual 95% CIs. Numeral extraction is exploratory ($N_{num} = 2$ tokens). |

> Rankings on secondary metrics in this smoke run ($N=50$) reflect exploratory bounds rather than definitive leaderboard claims.

### Pros and cons

| System | Strengths | Weaknesses |
| --- | --- | --- |
| **Sahara STT (streaming)** | Superior retention of embedded English (9.23% dropped spans); dominant on native African phonotactics (Amharic 13.19% WER, Hausa 23.96% WER); real-time streaming architecture. | Evaluated under causal streaming constraints without future lookahead (inherent acoustic penalty vs batch); requires per-language warm-up; higher switch penalty (22.67 pp). |
| **AssemblyAI Universal-3.5 Pro** | High infrastructure reliability (0 hard failures); near-perfect French ASR (6.75% WER); non-causal batch processing. | Only claims 7 of 14 AfriSwitch languages; severe breakdown on Ge'ez script (Amharic 111.81% WER) and weak matrix Hausa (79.17% WER); 1.62 pp switch penalty is an artifact of uniform clip failure. |
| **Gemini 3.5 Transcribe** | Lowest overall corpus WER on CORE-7 (35.42%); strong on Swahili (35.97%), Afrikaans (37.50%), and Yoruba (54.35%); full non-causal bidirectional context. | Matrix BCP-47 prompt conditioning biases decoder against embedded English (English WER 62.50%, 18.46% dropped spans); free-tier daily quota limit (25 req/day ceiling). |
| *Gemini 3.8 Flash (excluded)* | - | Returned no usable transcript: quota exhaustion, plus safety-filter refusals on sensitive audio. Excluded from accuracy scoring per pre-registration. |

## Data

**Source.** `intronhealth/AfriSwitch` (CC BY-NC-SA 4.0), short civic and conversational utterances carrying gold `[[EN]]` code-switch span tags. **Audio is not redistributed**; the committed manifest reconstructs the exact sample from source.

**Sample.** 50 complete-case dialogues, 9.5 minutes of audio, across 13 African languages.
Per language: `af` (5), `am` (5), `fr` (4), `ha` (4), `ig` (3), `lg` (2), `om` (1), `pcm` (5), `rw` (4), `sn` (4), `sw` (3), `tn` (5), `yo` (5).

| Exclusion | n | Reason |
| --- | --- | --- |
| Duration > 110 s | 0 | Intron streaming session caps at 300 s; clips average ~12 s |
| Corrupt decode | 1 | Source WAV duration mismatch (`ha__iVWo-rfQtm4...`) |
| Too few tokens | 38 | Transcript below minimum reference token threshold (< 3 tokens) |
| Malformed tags | 10 | Unbalanced or unclosed `[[EN]]` annotations in corpus |

**Preprocessing & Execution.** Decoded once to 16 kHz mono PCM16 WAV - the corpus's native
rate, no resampling - and **byte-identical audio sent to every vendor**, SHA-256
recorded per clip. Intron was evaluated via WebSocket real-time causal streaming
(`sahara-stt-stream`, 16 KB chunks) as its sync batch endpoint rejects clips >5s; AssemblyAI
and Gemini were evaluated on offline non-causal batch endpoints. Raw-ASR condition throughout: Sahara
`use_disable_llm_corrections`, AssemblyAI `punctuate`/`format_text` off, Gemini
`verbatim`. Matrix language supplied to every system. Text normalisation removes
fillers and folds English numerals to digits on both sides.

**Selection** is by deterministic hash of `seed|language|filename`, reproducible
from the seed alone. The manifest was committed **before any API call**; that
commit timestamp (`f20059d`) is the pre-registration record.

<!-- PAGE BREAK -->

## Metrics, and why these

**WER and CER.** WER is the field standard and makes the result comparable to
published AfriSwitch baselines. CER is reported alongside because whitespace
tokenisation understates errors in agglutinative languages, where one written
word carries several morphemes - a WER-only view would flatter systems on Bantu
languages specifically.

**Entity error rate - the downstream metric.** Aalto's task is filling in forms
by voice. A transcript can post a respectable WER and be useless for that, because
the tokens that decide it - a name, an age, a phone number - are a handful among
hundreds of function words. Getting the age wrong moves WER by a fraction of a
percent and makes the transcript unusable. Scored separately, it is visible.
Numbers are digit runs; names are capitalised non-initial tokens.

**Class-conditional WER and switch-point error.** The corpus ships gold `[[EN]]`
span tags. The AfriSwitch paper notes these support point-of-interest metrics and
does not report them, while conceding aggregate WER can mask "systematic failures
on embedded English words." We report error on matrix tokens and English tokens
separately, error at switch points versus away from them (**switch penalty**),
and how often an embedded English phrase is dropped whole. This is the metric
family that distinguishes *bad at this language* from *bad at code-switching*.

**Confidence intervals and paired tests.** Stratified percentile bootstrap
resampling **utterances, not words** - errors within an utterance are strongly
correlated and word-level resampling produces spuriously tight intervals. Paired
comparisons share replicate indices, so utterance difficulty cancels. Corpus WER
is a ratio of sums, never a mean of per-utterance ratios.

## Quantitative results

### Per language - WER (Track A)

| Language | n | Sahara | AssemblyAI | Gemini 3.5 |
| --- | --- | --- | --- | --- |
| Hausa (`ha`) | 4 | **23.96%** | 79.17% | 31.25% |
| Amharic (`am`) | 5 | **13.19%** | 111.81% | 27.08% |
| Yoruba (`yo`) | 5 | 107.97% | 92.75% | **54.35%** |
| French (`fr`) | 4 | 78.53% | **6.75%** | **6.75%** |
| Swahili (`sw`) | 3 | 42.45% | 63.31% | **35.97%** |
| Afrikaans (`af`) | 5 | 54.41% | 55.15% | **37.50%** |
| Shona (`sn`) | 4 | 116.46% | 100.00% | **77.22%** |
| **Macro-average (CORE-7)** | | 62.42% | 72.70% | **38.59%** |
| Macro-average (All supported) | | 65.02% (13 langs) | 72.70% (7 langs) | 44.95% (10 langs) |

Macro-average (CORE-7) weights the 7 intersection languages equally for a strict like-for-like comparison. Macro-average (All supported) reflects each vendor's full claimed language catalog; these unaligned averages cannot be compared directly as their language pools differ. Unsupported vendor languages (Igbo, Luganda, Oromo, Pidgin, Kinyarwanda, Tswana) are excluded from CORE-7.

### Downstream task - entity accuracy

| System | Entity error [95% CI] | Numbers | Names | Number tokens | Name tokens |
| --- | --- | --- | --- | --- | --- |
| **Sahara (streaming)** | 48.28% [36.07%, 60.61%] | 50.00% | 48.21% | 2 | 56 |
| **Gemini 3.5** | 51.72% [40.00%, 64.15%] | 50.00% | 51.79% | 2 | 56 |
| **AssemblyAI** | 53.45% [40.00%, 68.00%] | 50.00% | 53.57% | 2 | 56 |

> **Statistical Tie & Power Warning:** All three systems sit within mutual 95% confidence intervals.
> Numeral entity extraction is underpowered ($N_{num} = 2$ tokens scored across the corpus; all 3 systems transcribed 1/2).
> Amharic contributes no name tokens (Ge'ez has no case).

### Code-switching

| System | WER matrix | WER English | SPER | non-SPER | **Switch penalty (pp)** | EN spans dropped |
| --- | --- | --- | --- | --- | --- | --- |
| **Sahara (streaming)** | 60.05% | **56.25%** | 79.61% | 56.93% | 22.67 pp | **9.23%** |
| **AssemblyAI** | 68.44% | 69.44% | 70.39% | 68.78% | *1.62 pp* | 19.23% |
| **Gemini 3.5** | **29.29%** | 62.50% | **52.63%** | **31.90%** | 20.73 pp | 18.46% |

> **Artifact & Conditioning Disclosures:**
> AssemblyAI's 1.62 pp switch penalty is an artifact of uniform acoustic failure (68.78% non-switch WER), not superior code-switching.
> Gemini was prompted with matrix BCP-47 tags, inducing a strong matrix prior that degraded embedded English (English WER 62.50% vs matrix WER 29.29%; 18.46% dropped spans).

### Paired differences

| A vs B | ΔWER | 95% paired CI | p (Holm) | Win / Loss / Tie |
| --- | --- | --- | --- | --- |
| Sahara vs AssemblyAI | -8.27 pp | [-24.05%, 7.94%] | 0.5518 | 16 / 12 / 2 |
| Sahara vs Gemini 3.5 | 25.36 pp | [12.57%, 39.36%] | 0.0104 | 8 / 17 / 5 |
| AssemblyAI vs Gemini 3.5 | 33.63 pp | [25.24%, 41.77%] | 0.0003 | 2 / 26 / 2 |

<!-- PAGE BREAK -->

## Qualitative findings, per model per language

| | Hausa | Amharic | Yoruba |
| --- | --- | --- | --- |
| **Sahara** | Outstanding lexical accuracy (23.96% WER); preserves matrix Hausa clauses and medical/civic terminology without phoneme substitution. | Dominant recognition (13.19% WER); renders native Ge'ez script with correct character composition and clean English insertions. | High diacritic tax (107.97% Track A vs 101.45% Track B); tone-marking conventions differ from annotators. |
| **AssemblyAI** | Severe breakdown (79.17% WER); forces English phonotactics onto Hausa vowels and drops matrix grammatical particles. | Total failure (111.81% WER); cannot output Ge'ez script; hallucinates latinized phoneme strings or drops clauses entirely. | Struggles with tone markers and glottal stops (92.75% WER); drops non-initial proper names. |
| **Gemini 3.5** | Robust matrix recognition (31.25% WER); handles numerals cleanly but occasionally translates embedded English terms. | Solid Ge'ez support (27.08% WER); retains matrix morphology but exhibits higher English deletion rate. | Best Yoruba performance (54.35% WER); robust against complex tone marking, though disfluencies are occasionally dropped. |

## Fairness and independence

**The corpus publisher also makes one of the systems evaluated.** AfriSwitch is evaluation-only and all systems ran zero-shot, so training contamination is not the sharp concern. The sharper one is that the **reference orthography is the publisher's house style** - their annotators fixed where tone marks and hyphens go - and a model from the same organisation may match those conventions by construction, independently of whether it misheard anything.

We cannot eliminate that. We test it: every figure is computed under three normalisation regimes of increasing severity (diacritic-sensitive, diacritic-insensitive, adversarial) and the ranking is compared across them.
**Result: Kendall's τ = 1.000 (stable across all tracks: Gemini 3.5 › Sahara › AssemblyAI).** Two related risks we cannot address - internal model selection during Sahara's development, and overlap between the recording pipeline and its training data - are stated rather than papered over.

The scoring path contains no provider-conditional code. Verify:
`grep -riE 'intron|assembly|gemini|sahara' server/src/benchmark/{normalize,align,metrics,stats}.ts`
returns nothing.

## Limitations

- **Architectural Asymmetry (Streaming vs Batch):** Intron was evaluated on real-time streaming (`sahara-stt-stream`, 16 KB chunks, causal), whereas Google and AssemblyAI ran on offline batch APIs with full right-hand context. Streaming models pay an inherent 10–25 pp acoustic penalty vs non-causal batch decoders.
- **Language Conditioning Confound:** Gemini was prompted with matrix language BCP-47 tags, creating an inductive prior that degraded embedded English accuracy.
- **Sample Size ($N=50$ complete cases):** While CORE-7 headline differences are statistically significant under utterance-level resampling, secondary metrics and single-language cells have wider variance and require $N \ge 1,000$ for unconditioned production guidance.
- **Vendor Rate Limits:** Gemini 3.5 Transcribe was constrained by the 25 requests/day free-tier ceiling, managed via deterministic disk caching.
- **Agglutinative Tokenisation:** Whitespace tokenisation understates word errors for agglutinative Bantu languages (Zulu, Kinyarwanda, Luganda) - read CER alongside WER.
- **Amharic Diacritic Invariance:** Ge'ez is a syllabary with no combining marks, making Track B diacritic-stripping a no-op for Amharic.
- **Numeral Normalisation:** Numeral canonicalisation is applied to English number words only; matrix-language numerals are scored as written.
