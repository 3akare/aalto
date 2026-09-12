# Aalto — Solution Description

> Draft. Fill in the bracketed sections with specifics before submitting.

## Problem

Many public-service and civic processes in African contexts have moved onto simple digital forms
(e.g. Google Forms for NGO registration, aid applications, community surveys, permit requests).
These forms are almost always English-only and text-only, which excludes people who:
- Are more comfortable speaking than typing, especially in a mix of English and their local language
  (Yoruba-English, Hausa-English, Nigerian Pidgin, etc.)
- Have limited literacy or find small-screen typing difficult
- Need to complete a form quickly, e.g. in a queue at a registration center

[Add a concrete stat or story here if you have one — e.g. literacy rate, a specific NGO/program
context, or number of people affected by a specific civic process you're targeting.]

## Target users

People who need to complete civic/public-service forms and manage related follow-up tasks
(e.g. "remind me to bring my ID Friday"), and who speak naturally in code-switched language rather
than formal English.

## Solution

Aalto is a voice-controlled browser agent. The user speaks naturally — mixing English and a local
language — to:
1. Search for and open the right form or civic service page
2. Fill out a Google Form field-by-field, entirely hands-free
3. Set a Todoist reminder for any follow-up action the form requires

The agent uses Intron's Speech-to-Text to transcribe code-switched speech, an LLM to interpret intent
and route it to the right browser or Todoist action, and Intron's Text-to-Speech to confirm each step
back to the user in a natural voice.

## Key technical decisions

- **Category:** Legal & Public Services (civic form accessibility)
- **STT:** Intron sync file-upload API for the demoed flow (simplicity, reliability for a short demo
  clip); a WebSocket streaming client is also implemented (`src/stt/intronStream.ts`) as the lower-latency
  path for a production version.
- **Intent routing:** Claude tool-calling maps a transcript (which may itself be code-switched or contain
  ASR noise) to one of a fixed set of structured actions, rather than a rigid regex/keyword parser, so the
  agent tolerates natural phrasing.
- **Form filling:** a content script matches spoken field labels to the visible question text on Google
  Forms via token-overlap similarity, since Forms doesn't expose clean `label for=""` bindings.
- **Todoist:** REST API v2, fuzzy-matched by spoken task description for complete/update actions.
- **Benchmarking:** [see BENCHMARK_REPORT.md — summarize headline WER/latency findings here once the
  benchmark has been run on real recorded samples.]

## Why this is agentic, not just a voice UI

[Describe how the agent chains multiple steps autonomously per utterance — e.g. it doesn't just
transcribe and stop, it decides which of 9 possible actions to take and, for Todoist, executes and
confirms the result without further user input.]

## Ethics & inclusion

See `ETHICS.md`.
