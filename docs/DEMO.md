# Demo — form to build, and the script

Target length: **2–3 minutes**. Judges watch a lot of these; the first twenty seconds decide whether
they watch the rest.

---

## 1. Build the form first

Create a Google Form called **"CAC Business Name Registration — Pre-screening"**. It needs to look
like a real Nigerian civic form, and it needs to exercise every field type Aalto handles.

| # | Question (use this exact wording) | Type | Why it's here |
| --- | --- | --- | --- |
| 1 | What is your full legal name? | Short answer | The verbose-question / short-spoken-label case that used to fail |
| 2 | Phone number | Short answer | Spoken digits → digits |
| 3 | National Identification Number (NIN) | Short answer | An 11-digit string, the hardest ASR case on the form |
| 4 | Date of birth | Date | Date parsing |
| 5 | State of residence | Dropdown — Lagos, Kano, Rivers, Oyo, FCT Abuja | Listbox handling |
| 6 | What type of business are you registering? | Multiple choice — Sole proprietorship, Partnership, Limited company, Incorporated trustees | Radio matching |
| 7 | Which documents do you already have? | Checkboxes — Valid ID, Proof of address, Passport photograph, Tax identification number | Multi-select from one utterance |

Set it to **not** require sign-in, and keep it on one page.

> Leave the form **blank and open** in a tab before you start recording.

---

## 2. The script

Speak naturally, including the code-switching. Don't over-enunciate — the whole point is that it
handles ordinary speech.

### Beat 1 — the problem (~15s, to camera or over the blank form)

> "This is a Nigerian business registration form. It's in English, it's all typing, and most people
> filling it don't speak English the way it's written. They speak like this —"

### Beat 2 — answer in place (~20s)

Press **Alt+A**:

> "Wetin be CAC?"

Aalto answers in the panel *and* speaks it. **Point out that you never left the form.** This is the
single clearest demonstration of the design principle — a normal assistant would have opened a search
tab and lost your place.

### Beat 3 — the agentic beat, and the one to lead with (~30s)

Press **Alt+A**:

> "My name is Ada Okafor, my phone number is zero eight zero three four five six seven eight nine
> zero, and my NIN na one two three four five six seven eight nine zero one."

Three fields fill at once. **Pause on the phone number and the NIN** — spoken digits landing as
digits is the thing that usually breaks voice form-fillers, and it's visible on screen.

### Beat 4 — the rest of the form, code-switched (~25s)

Press **Alt+A**:

> "I dey for Lagos, and na sole proprietorship I wan register. I get valid ID and passport photograph."

Dropdown, radio and checkboxes, from one sentence of Pidgin-English.

### Beat 5 — review before submit (~25s)

Press **Alt+A**:

> "Read back wetin I don fill."

Aalto reads every question and its value, including **"date of birth: still blank"**. Say out loud
that it caught the missed field.

Then press **Alt+A**:

> "Add am — fifteenth of March nineteen ninety — then submit the form."

It fills the date and **refuses to submit**, telling you to review first. **This is the most important
ten seconds of the demo.** Say why: a wrong answer submitted to a government body isn't something the
applicant can take back, so the refusal is enforced in code, not just asked for in a prompt.

Then:

> "Okay, submit it."

It submits.

### Beat 6 — the benchmark (~30s)

Cut to `docs/BENCHMARK_REPORT.md` on screen. Scroll slowly through:

- the conflict-of-interest section — *"we say plainly that the corpus publisher also makes one of the
  systems we're testing"*
- the code-switching table — *"error rate at the switch points themselves, which the corpus paper's
  own tags support and which it doesn't report"*
- the ranking-stability table — *"and we test whether the result survives three different scoring
  regimes"*

### Beat 7 — close (~10s)

> "Aalto. Speak the language you actually speak, and the form still gets filled."

---

## 3. Recording notes

- **Screen record at 1080p or better**, with a visible cursor. The popup is small.
- **Record audio separately if you can.** Your microphone is feeding Aalto; a headset mic for
  narration and the built-in for commands avoids the two fighting.
- **Mute Aalto's replies during narration** (the speaker toggle) if the two voices collide, and say
  that's what you're doing — it shows the control exists.
- **Do a full dry run first.** Latency is around 7 seconds per command; knowing where the pauses fall
  lets you cut them.
- If a command misfires, **keep going and retry on camera**. A visible retry is more honest than a
  suspiciously perfect take, and judges have seen enough demos to know the difference.

## 4. Before you hit record

```bash
cd server && npm run smoke      # every provider, end to end
npm run dev
```

- Extension reloaded at `chrome://extensions` after the last change
- Microphone already granted (the grant page doesn't belong in the video)
- `Alt+A` confirmed working at `chrome://extensions/shortcuts`
- Todoist open in another tab if you want to show the task landing
- Form blank, open, and the active tab

## 5. Upload

Unlisted or public YouTube link. Title it `Aalto — voice-driven civic form access (Sahara/Intron
hackathon)` and put the repo URL in the description.
