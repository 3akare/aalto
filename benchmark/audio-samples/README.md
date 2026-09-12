# Benchmark audio samples

Drop `.wav` clips here, each with a matching reference transcript and (optional) metadata file:

```
sample1.wav
sample1.txt         <- exact reference transcript, plain text
sample1.meta.json   <- optional: { "languageCode": "yo", "description": "Yoruba-English, form field: full name" }
```

## What to record (aim for 10-20 short clips, each 5-15 seconds)

Cover the actual demo scenario — civic form filling + task follow-up — so the benchmark reflects
real usage, not generic sentences:

- A few clips of natural code-switched Yoruba-English (or Pidgin-English) filling out form fields,
  e.g. "Orukọ mi ni Ada Okafor" (my name is Ada Okafor) mixed with English phrasing
- A few pure-English control clips of the same content, to see how much code-switching specifically
  degrades each model vs. a language-pair baseline
- A few Todoist-style commands ("fi mi si iranti lati mu iwe idanimọ mi wá ni Friday" / "remind me to
  bring my ID Friday")
- Vary background noise/pace slightly to avoid an artificially clean benchmark

Keep clips under 120 seconds (Intron's sync endpoint limit) — well under, ideally, since the demo
scenario is short spoken commands anyway.

Run `npm run benchmark` from `server/` once samples are in place.
