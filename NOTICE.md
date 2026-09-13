# Third-party notices

Aalto's own source is MIT licensed (see [LICENSE](LICENSE)). It redistributes
the following, each under its own terms.

## Cormorant Garamond - SIL Open Font License 1.1

`extension/fonts/CormorantGaramond-Regular.ttf`
Copyright 2015 the Cormorant Project Authors, github.com/CatharsisFonts/Cormorant

The font binary is bundled rather than fetched from a CDN, because Manifest V3's
content security policy blocks remote resources on extension pages. The OFL
requires its licence text to accompany any redistribution of the font, so the
full licence sits beside it at [`extension/fonts/OFL.txt`](extension/fonts/OFL.txt).

## Remix Icon - Apache License 2.0

`extension/icons.js` contains SVG path data from Remix Icon 4.6.0
(https://remixicon.com), Copyright the RemixIcon authors, used under Apache-2.0.
Bundled as path data for the same CSP reason. No modifications beyond extracting
the `d` attribute of each glyph.

## AfriSwitch and AfriSwitchCare - CC BY-NC-SA 4.0

https://huggingface.co/datasets/intronhealth/AfriSwitch
https://huggingface.co/datasets/intronhealth/AfriSwitchCare
Published by Intron Health.

**The audio is not redistributed here.** `benchmark/audio-samples/` is
git-ignored, and the sampling manifest under `benchmark/manifest/` exists so a
reader can reconstruct our exact sample from the original source rather than from
a copy of it we handed them.

The licence is non-commercial and share-alike. Material in this repository that
is derived from those corpora - the benchmark report, the metrics it contains,
and the transcript excerpts in the manifest - is therefore offered under
**CC BY-NC-SA 4.0**, not MIT. The MIT grant covers the code.

## Services

Aalto calls Intron (Sahara Voice AI), Google Gemini, AssemblyAI and Todoist at
runtime under their respective terms. No vendor SDK or model weight is
redistributed here.
