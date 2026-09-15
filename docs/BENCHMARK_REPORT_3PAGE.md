# Code-Switching Speech Benchmark - Aalto

**Sahara STT · AssemblyAI Universal-3.5 Pro · Gemini 3.5 Transcribe**
Run 2026-09-15 · corpus `intronhealth/AfriSwitch` @ `f20059d` · seed `aalto-afriswitch-v1`
Full report, code and manifest: **github.com/3akare/aalto**

## Summary

Google Gemini 3.5 Transcribe achieved the lowest headline corpus Word Error Rate on the CORE-7 languages at 35.42% [29.12%, 42.50%], significantly outperforming Intron Sahara STT (60.78% [46.86%, 75.96%], paired Δ=25.36 pp, p=0.0104) and AssemblyAI Universal-3.5 Pro (69.05% [61.94%, 76.64%], paired Δ=33.63 pp, p=0.0003). However, on downstream form-filling utility—entity accuracy on names and numbers—Intron Sahara STT led at 48.28% [36.07%, 60.61%], ahead of Gemini (51.72%) and AssemblyAI (53.45%), with all three systems within mutual confidence intervals. Sahara demonstrated superior retention of embedded English words, dropping only 9.23% of code-switched English spans compared to ~18–19% dropped by Gemini and AssemblyAI, and established dominant leads on core African languages including Amharic (13.19% vs 111.81%) and Hausa (23.96% vs 79.17%).

| Metric | Best | Result | Next best |
| --- | --- | --- | --- |
| Corpus WER (Track A, CORE-7) | **Gemini 3.5 Transcribe** | 35.42% | Sahara STT 60.78% |
| Entity error (names + numbers) | **Sahara STT** | 48.28% | Gemini 3.5 51.72% |
| Error on embedded English | **Sahara STT** | 56.25% | Gemini 3.5 62.50% |
| Switch penalty | **AssemblyAI Universal-3.5 Pro** | 1.62 pp | Gemini 3.5 20.73 pp |
| English spans dropped | **Sahara STT** | 9.23% | Gemini 3.5 18.46% |

> Ranking first is not the same claim as a significant difference. With this
> sample several margins sit inside the intervals - see the paired tests overleaf.

### Pros and cons

| System | Strengths | Weaknesses |
| --- | --- | --- |
| **Sahara STT** | Lowest entity error rate (48.28%); best embedded English retention (dropped only 9.23% spans); exceptional recognition on Amharic (13.19% WER) and Hausa (23.96% WER). | Per-language model warm-up required on cold sessions; higher switch penalty (22.67 pp) at language boundaries; struggles on French and Yoruba without tone hints. |
| **AssemblyAI Universal-3.5 Pro** | Batch API, reliable infrastructure (0 hard failures); near-perfect French ASR (6.75% WER); lowest switch penalty (1.62 pp). | Only claims 7 of 14 AfriSwitch languages; severe breakdown on Ge'ez script (Amharic 111.81% WER) and weak matrix Hausa (79.17% WER). |
| **Gemini 3.5 Transcribe** | Lowest overall corpus WER on CORE-7 (35.42%); strong on Swahili (35.97%), Afrikaans (37.50%), and Yoruba (54.35%); verbatim mode matches raw-ASR protocol. | Free-tier daily quota limit (25 req/day ceiling); higher embedded English deletion rate (18.46%). |
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

**Preprocessing.** Decoded once to 16 kHz mono PCM16 WAV - the corpus's native
rate, no resampling - and **byte-identical audio sent to every vendor**, SHA-256
recorded per clip. Raw-ASR condition throughout: Sahara
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

Macro-average weights each language equally. A corpus-weighted average would let
the best-served language hide failures in the others. Unsupported vendor languages (Igbo, Luganda, Oromo, Pidgin, Kinyarwanda, Tswana) are excluded from CORE-7.

### Downstream task - entity accuracy

| System | Entity error [95% CI] | Numbers | Names | Number tokens | Name tokens |
| --- | --- | --- | --- | --- | --- |
| **Sahara** | **48.28%** [36.07%, 60.61%] | 50.00% | 48.21% | 2 | 56 |
| **Gemini 3.5** | 51.72% [40.00%, 64.15%] | 50.00% | 51.79% | 2 | 56 |
| **AssemblyAI** | 53.45% [40.00%, 68.00%] | 50.00% | 53.57% | 2 | 56 |

Amharic contributes no name tokens: Ge'ez has no case, so the name heuristic
cannot apply. That is an absence of measurement, not a score of zero.

### Code-switching

| System | WER matrix | WER English | SPER | non-SPER | **Switch penalty** | EN spans dropped |
| --- | --- | --- | --- | --- | --- | --- |
| **Sahara** | 60.05% | **56.25%** | 79.61% | 56.93% | 22.67 pp | **9.23%** |
| **AssemblyAI** | 68.44% | 69.44% | 70.39% | 68.78% | **1.62 pp** | 19.23% |
| **Gemini 3.5** | **29.29%** | 62.50% | **52.63%** | **31.90%** | 20.73 pp | 18.46% |

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

- **Domain matched.** Evaluated on `intronhealth/AfriSwitch` (civic-domain conversational code-switching speech), addressing the target domain directly.
- **Sample size.** 50 complete cases across 13 of 14 languages. While headline intervals on CORE-7 are well-bounded, single-language cells (e.g. Oromo, Luganda) have wider variance.
- **Vendor rate limits.** Gemini 3.5 Transcribe was constrained by the 25 requests/day free-tier ceiling, requiring careful pacing and excluding some extended runs.
- **English-only numeral folding.** Yoruba's vigesimal system is out of scope - symmetric across systems, but residual variance remains.
- **Track B is undefined for Amharic.** Ge'ez is a syllabary; diacritic-stripping is meaningless, so that comparison is marked N/A rather than fudged.
- **Single run.** Vendor-side variance is unmeasured; Intron streaming requires explicit session warm-up to prevent cold-start disconnects.
