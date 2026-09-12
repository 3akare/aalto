# Aalto

A voice-controlled browser agent built for the Sahara/Intron Voice AI hackathon (and adapted for AssemblyAI).

Aalto lets someone **speak** — including naturally code-switched speech (e.g. Yoruba-English, Pidgin-English) —
to control a browser: search the web, open/switch tabs, fill out Google Forms hands-free, and manage tasks in
Todoist. It targets **Legal & Public Services / civic accessibility**: people who are more comfortable speaking
in mixed local language than typing English-only forms.

## Repo layout

```
aalto/
├── extension/          Chrome extension (Manifest V3) — mic capture, tab control, Google Forms filling
├── server/             Node/TypeScript orchestrator — STT/TTS abstraction, intent routing, Todoist integration
├── benchmark/          Code-switching speech benchmark harness + audio samples + results
└── docs/               Solution description, ethics note, benchmark report (for hackathon submission)
```

## How it works

1. **Capture** — the extension records mic audio in the popup/offscreen document.
2. **Transcribe** — audio is sent to the orchestrator server, which calls the active STT provider
   (Intron by default; Whisper and a third provider are used for benchmarking).
3. **Understand** — the orchestrator sends the transcript to an LLM with a tool-calling schema
   (`search`, `open_tab`, `switch_tab`, `fill_form_field`, `submit_form`, `todoist_add`, `todoist_complete`,
   `todoist_update`) and gets back a structured action.
4. **Act** — the extension executes the action in the browser (tabs API, content-script DOM injection for
   Google Forms) or the server calls the Todoist API directly.
5. **Respond** — a short confirmation is spoken back via Intron TTS.

## Quick start

```bash
cd server
cp .env.example .env   # fill in your API keys
npm install
npm run dev
```

Then load the extension:
1. Go to `chrome://extensions`
2. Enable Developer Mode
3. "Load unpacked" → select the `extension/` folder
4. Click the Aalto icon, hit the mic button, and talk.

## Benchmarking

```bash
cd server
npm run benchmark
```

This runs every `.wav` file in `benchmark/audio-samples/` (with a matching `.txt` reference transcript)
through all configured STT providers and writes a comparison report to `benchmark/results/`.

See `docs/` for the hackathon submission write-ups (solution description, ethics note, benchmark report).
