# Ethics, Safety & Inclusion Note

> Draft. Fill in the bracketed sections with what you actually did before submitting.

## Consent & data use

- All benchmark audio samples in `benchmark/audio-samples/` were recorded by [you], with informed
  consent for use in this hackathon submission and any accompanying demo video.
- No third-party or scraped audio was used without consent.
- [If you recorded anyone else's voice, describe how consent was obtained and how they were informed
  the recording would be shared publicly as part of a hackathon submission.]

## Privacy

- Audio is sent directly from the browser extension to the local/self-hosted orchestrator server and
  from there to the STT provider APIs (Intron, and comparison providers during benchmarking only) —
  it is not persisted to disk beyond what each provider's API itself retains.
- Form field values entered via voice are only ever written into the form the user has open; Aalto does
  not log or transmit form contents anywhere else.
- Todoist tasks are read/written only via the user's own API token, scoped to their own account.
- API keys are stored in `.env` (git-ignored) and never hard-coded or committed.

## Bias awareness

- Code-switching benchmark performance is reported per-sample and per-language-pair rather than as a
  single blended number, since averaging across very different code-switch patterns can hide where a
  model actually struggles (e.g. a model may handle Yoruba-English well but do poorly on Hausa-English).
- [Note any known limitations you observed — e.g. a provider consistently mis-transcribing a specific
  language pair, or accent-related failure patterns you noticed while recording samples.]

## Respect for user dignity

- The target use case (civic form completion) is framed around giving people a *choice* of modality
  (speak instead of type), not replacing their agency — the agent asks for clarification (`clarify` tool)
  rather than guessing and submitting incorrect information on their behalf, and form submission is a
  distinct, explicit final action rather than something that happens silently.
- [Add anything else relevant, e.g. how you'd handle a user wanting to review filled fields before
  submission in a non-demo version.]
