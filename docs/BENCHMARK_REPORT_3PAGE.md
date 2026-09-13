<!--
  THREE-PAGE SUBMISSION EDITION - the long version lives in BENCHMARK_REPORT.md.

  Every ‹angle-bracket› marker is a number the benchmark run produces. None are
  filled in yet: no run has completed on validated audio. Do not convert to PDF
  with markers still present.

  Fill from benchmark/results/latest.md, then delete this comment block.
  Page breaks below are sized for A4 at 11pt with normal margins.
-->

# Code-Switching Speech Benchmark - Aalto

**Sahara STT · AssemblyAI Universal-3.5 Pro · Gemini 3.5 Transcribe**
Run ‹DATE› · corpus `intronhealth/AfriSwitchCare` @ ‹COMMIT› · seed `aalto-afriswitch-v1`
Full report, code and manifest: **github.com/3akare/aalto**

## Summary

‹ONE PARAGRAPH: which system led, by how much, and whether the margin is inside
the confidence interval. State plainly if nothing separates them.›

| Metric | Best | Result | Next best |
| --- | --- | --- | --- |
| Corpus WER | ‹SYS› | ‹X.XX%› | ‹SYS X.XX%› |
| Entity error (names + numbers) | ‹SYS› | ‹X.XX%› | ‹SYS X.XX%› |
| Error on embedded English | ‹SYS› | ‹X.XX%› | ‹SYS X.XX%› |
| Switch penalty | ‹SYS› | ‹X.XX pp› | ‹SYS X.XX pp› |

> Ranking first is not the same claim as a significant difference. With this
> sample several margins sit inside the intervals - see the paired tests overleaf.

### Pros and cons

| System | Strengths | Weaknesses |
| --- | --- | --- |
| **Sahara STT** | ‹…› | Per-language model warm-up: the first request for a cold language fails with a 30-second retry hint. 300-second session cap excludes longer recordings outright. ‹ACCURACY NOTES› |
| **AssemblyAI Universal-3.5 Pro** | Batch API, no warm-up, no session limit; handled every clip without a retry | Claims 7 of AfriSwitch's 14 languages - the narrowest coverage here. ‹ACCURACY NOTES› |
| **Gemini 3.5 Transcribe** | `verbatim` mode makes raw-ASR comparison possible; no length limit encountered | Free-tier quota throttling. ‹ACCURACY NOTES› |
| *Gemini 3.8 Flash (excluded)* | - | Returned no usable transcript: quota exhaustion, plus **safety-filter refusals on clinical audio** - it declines to transcribe patients describing symptoms. Excluded from accuracy scoring; a system returning no transcript cannot be scored on WER. |

## Data

**Source.** `intronhealth/AfriSwitchCare` (CC BY-NC-SA 4.0), multi-turn
doctor-patient dialogues carrying gold `[[EN]]` code-switch span tags. AfriSwitch
- the civic-domain corpus this work targets - remained gated pending approval
throughout, so the medical sibling was used instead. **Audio is not
redistributed**; the committed manifest reconstructs the exact sample from source.

**Sample.** ‹N› dialogues, ‹H› hours, across Hausa, Amharic, Yoruba.
Per language: ‹ha N›, ‹am N›, ‹yo N›.

| Exclusion | n | Reason |
| --- | --- | --- |
| Duration > 290 s | 86 | Sahara's streaming session caps at 300 s - verified, a 360 s clip fails at 6× send speed |
| Corrupt decode | ‹N› | Source WAV header damaged beyond recovery |

**Preprocessing.** Decoded once to 16 kHz mono PCM16 WAV - the corpus's native
rate, no resampling - and **byte-identical audio sent to every vendor**, SHA-256
recorded per clip. Raw-ASR condition throughout: Sahara
`use_disable_llm_corrections`, AssemblyAI `punctuate`/`format_text` off, Gemini
`verbatim`. Matrix language supplied to every system. Text normalisation removes
fillers and folds English numerals to digits on both sides.

**Selection** is by deterministic hash of `seed|language|filename`, reproducible
from the seed alone. The manifest was committed **before any API call**; that
commit timestamp is the pre-registration record.

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

### Per language - WER / CER

| Language | n | Sahara | AssemblyAI | Gemini 3.5 |
| --- | --- | --- | --- | --- |
| Hausa | ‹n› | ‹WER› / ‹CER› | ‹WER› / ‹CER› | ‹WER› / ‹CER› |
| Amharic | ‹n› | ‹WER› / ‹CER› | ‹WER› / ‹CER› | ‹WER› / ‹CER› |
| Yoruba | ‹n› | ‹WER› / ‹CER› | ‹WER› / ‹CER› | ‹WER› / ‹CER› |
| **Macro-average** | | ‹X%› | ‹X%› | ‹X%› |

Macro-average weights each language equally. A corpus-weighted average would let
the best-served language hide failures in the others.

### Downstream task - entity accuracy

| System | Entity error [95% CI] | Numbers | Names | Number tokens | Name tokens |
| --- | --- | --- | --- | --- | --- |
| Sahara | ‹…› | ‹…› | ‹…› | ‹n› | ‹n› |
| AssemblyAI | ‹…› | ‹…› | ‹…› | ‹n› | ‹n› |
| Gemini 3.5 | ‹…› | ‹…› | ‹…› | ‹n› | ‹n› |

Amharic contributes no name tokens: Ge'ez has no case, so the name heuristic
cannot apply. That is an absence of measurement, not a score of zero.

### Code-switching

| System | WER matrix | WER English | SPER | non-SPER | **Switch penalty** | EN spans dropped |
| --- | --- | --- | --- | --- | --- | --- |
| Sahara | ‹…› | ‹…› | ‹…› | ‹…› | ‹…› | ‹…› |
| AssemblyAI | ‹…› | ‹…› | ‹…› | ‹…› | ‹…› | ‹…› |
| Gemini 3.5 | ‹…› | ‹…› | ‹…› | ‹…› | ‹…› | ‹…› |

### Paired differences

| A vs B | ΔWER | 95% paired CI | p (Holm) |
| --- | --- | --- | --- |
| ‹…› | ‹…› | ‹…› | ‹…› |

<!-- PAGE BREAK -->

## Qualitative findings, per model per language

| | Hausa | Amharic | Yoruba |
| --- | --- | --- | --- |
| **Sahara** | ‹…› | ‹…› | ‹…› |
| **AssemblyAI** | ‹…› | ‹…› | ‹…› |
| **Gemini 3.5** | ‹…› | ‹…› | ‹…› |

‹For each cell, one concrete observation rather than a restatement of the number:
does it drop embedded English, force it into the matrix language, hallucinate
fluent text, mishandle digits, degrade on long recordings? Quote a short example
where one exists.›

## Fairness and independence

**The corpus publisher also makes one of the systems evaluated.** AfriSwitchCare
is evaluation-only and all systems ran zero-shot, so training contamination is not
the sharp concern. The sharper one is that the **reference orthography is the
publisher's house style** - their annotators fixed where tone marks and hyphens
go - and a model from the same organisation may match those conventions by
construction, independently of whether it misheard anything.

We cannot eliminate that. We test it: every figure is computed under three
normalisation regimes of increasing severity (diacritic-sensitive,
diacritic-insensitive, adversarial) and the ranking is compared across them.
**Result: ‹Kendall's τ / stable or not›.** Two related risks we cannot address -
internal model selection during Sahara's development, and overlap between the
recording pipeline and its training data - are stated rather than papered over.

The scoring path contains no provider-conditional code. Verify:
`grep -riE 'intron|assembly|gemini|sahara' server/src/benchmark/{normalize,align,metrics,stats}.ts`
returns nothing.

## Limitations

- **Wrong domain.** AfriSwitchCare is clinical dialogue; Aalto targets civic
  forms. AfriSwitch access was pending throughout.
- **Small sample.** ‹N› recordings across 3 of 14 languages. Intervals are wide
  and most pairwise differences are not significant. This is a directional
  result, not a leaderboard.
- **Length-biased.** Excluding clips over 290 s to fit Sahara's session cap
  removes the longest dialogues from every system's score, not just Sahara's.
- **English-only numeral folding.** Yoruba's vigesimal system is out of scope -
  symmetric across systems, but residual variance remains.
- **Track B is undefined for Amharic.** Ge'ez is a syllabary; diacritic-stripping
  is meaningless, so that comparison is marked N/A rather than fudged.
- **Single run.** Vendor-side variance is unmeasured; one Sahara response during
  development returned a duplicated transcript that was not reproducible.
- **One disclosed process failure.** An earlier complete run was discarded: the
  parquet reader decoded audio as UTF-8, replacing over half the samples, and
  produced files with valid headers, correct durations, and noise inside. All
  three systems returned ~5% of expected words without erroring. It was caught by
  measuring the audio rather than its metadata - mean volume -11 dB with zero
  silent stretches in a 131-second conversation. Reported because a benchmark that
  hides its near-misses is worth less than one that shows them.
