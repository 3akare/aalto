# Benchmark audio samples

**This directory is generated, and its contents are never committed.**

`npm run corpus -- <tier> <dataset>` from `server/` downloads the corpus, selects
a sample and writes one triplet per utterance:

```
<id>.wav          16 kHz mono PCM16, transcoded once so every vendor gets identical bytes
<id>.txt          reference transcript
<id>.meta.json    languageCode, cmi, numSwitchPoints, duration, transcriptionTagged
```

The audio is licensed CC BY-NC-SA 4.0 and is **not redistributed**. Only metrics,
statistics and the sampling manifest are published. The manifest in
`benchmark/manifest/` is what lets anyone reconstruct this exact sample from the
original source rather than from a copy of it.

Everything here except this file is git-ignored.
