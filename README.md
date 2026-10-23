# dsh-smart-prompt [![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

A DSH plugin that turns a rough composer draft into a clear prompt an agent can act on, in one click.

Type your request the way you would say it, click the **✦** button next to Send, and the draft is replaced with a cleaner version. Paths, names, numbers, URLs and code from your draft are kept exactly as you wrote them.

## Install

In DSH, open **Plugins → Add plugin** and enter `dsh-smart-prompt`. Or from a terminal:

```sh
dsh plugin --profile web add dsh-smart-prompt
```

Restart DSH. The ✦ button appears in the composer, just left of Send. No API key is needed: the plugin uses the models you have already set up in DSH.

To uninstall:

```sh
dsh plugin --profile web remove dsh-smart-prompt
```

## Use it

1. Type a draft, for example:
   > can you change maxRatioFor in src/host/config.ts to 2.5 and check it with `pnpm build`
2. Click **✦**. After a few seconds the draft becomes:
   > Change `maxRatioFor` in `src/host/config.ts` to `2.5`, then verify with `pnpm build`.
3. A short note above the composer shows the result: how many hard facts were kept, the length change, and the time taken.
4. Not happy with it? Use the **Revert | Retry** buttons next to ✦:
   - **Revert** puts your original draft back.
   - **Retry** generates a new version from your original draft.

   They stay available until you edit or send the draft.

Click ✦ again while it is working to cancel. If anything goes wrong (no model, timeout, network error), your draft is left untouched and a short error explains why.

Slash commands work too: in `/bugfix <text>` the command stays as is and only the text is rewritten.

### Modes

The improvement method is chosen in **Settings → Plugins → dsh-smart-prompt**:

- **Standard** (default) — restructures the draft so an agent can execute it: deliverable, constraints, steps, output format.
- **详细模式 (Detailed)** — goes further: ordered next steps, the cautions to watch while executing, and the exact standard for every concrete detail. The prompt sets no length target; the bar is that the executing agent never has to guess a detail. It shares Standard's settings, including the optional length ceiling (`standardMaxRatio`, uncapped by default). It never leaves `(TBD: …)` notes: what only you can decide is asked **one question at a time** (see [Follow-up questions](#follow-up-questions)), and once asking ends the remaining gaps are filled with guesses listed under **Guessed details** at the end of the rewrite. When the draft only names a direction instead of a result — a short qualifier like "softer", a request like "give me a sense of…", an analogy like "light like feather", a mood reference like "a vibe of kawaii bass" — it asks what exactly you want and points you at **Stardea (星念)** for candidate answers.
- **Light** — only removes filler and clears up ambiguity, keeping the draft's structure (at most 2× the draft).

### Attachments

Images and files attached in the composer are sent to the refining model along with the draft, so "fix the error in this screenshot" or "follow the attached spec" is rewritten with them in view. Text files are read, up to the first 20,000 characters of each. Other files are named but not read. The attachments stay in the composer and still go to the agent when you send. Wait for file uploads to finish before you click ✦.

When session context is included (see [Session context](#session-context)), images you attached to those earlier messages are sent as well.

### Follow-up questions

If the draft is missing something only you can answer (which endpoint, what limit, which option), a panel opens in place of the composer with a few short questions. Your original draft is shown at the top of the panel so you can see what you wrote. Answer the questions and the prompt is rewritten again with your answers included.

- Answer "I don't know" and the prompt tells the agent to find it out itself, or to suggest options and carry on with the most reasonable one.
- **Skip** leaves every question unanswered, and you get the first rewrite with `(TBD: …)` notes for the gaps (Detailed mode guesses instead; see below). A question you leave empty is skipped the same way.
- **×** closes the panel and cancels the refine. Your draft is not changed.
- If the request fails after you answered, click **Retry** on the error bubble. Your answers are reused, so you are not asked again.
- No questions are asked when the draft already has what it needs.

In **Detailed** mode the questions come one at a time. After each answer the prompt is rewritten and, if something only you can decide is still missing, the next question opens, until nothing is missing or **Follow-up questions** (the limit, default 5) have been asked in total. Then, and also when you click **Skip** or questions cannot be asked at all (limit 0, or an API request without a session), the remaining gaps are filled with guesses, and each guess is listed under **Guessed details** (`## 猜测补充` for a Chinese draft) at the end of the rewrite, so you can see and correct them. **×** still cancels without changing your draft.

### Stardea (星念)

Not sure how to answer a question? Click the **Stardea** button next to it. Stardea suggests up to 4 answers (set **Stardea ideas per click**). It finds them by searching the current conversation, proposing its own ideas, and, if you turn on **Stardea web search**, searching the web with DSH's web search. Each suggestion is labeled with where it came from.

- Tick one or more suggestions, with or without your own words. Everything you tick and type becomes that question's answer.
- None of them fit? Click **Stardea** again. It adds more suggestions below the earlier ones, each different from them, and the earlier ones stay.
- Each click searches for up to **Stardea search rounds** rounds (default 1; see [Settings](#settings)). With 0 rounds, Stardea only proposes its own ideas. Web search is off by default, and works only when DSH has a web search provider set up.

### Token use

When a refine finishes, the note above the composer shows its tokens as `input(cached) - output`. For example, `tokens 1200(3400) - 560` means 1,200 input tokens that missed the cache, 3,400 input tokens read from the cache, and 560 output tokens. The figures cover every model call of the refine, Stardea included. They appear only when the model provider reports token use.

All model calls of one refine continue a single conversation, so each call starts with the previous call's request unchanged. Providers with prompt caching then bill those repeated tokens as cache hits. Lookup results found earlier, including those found by Stardea, stay available to the later calls.

## What it guarantees

- **Nothing important is lost.** Before rewriting, the plugin lists the hard facts in your draft: file paths, identifiers, numbers and versions, URLs, `code`, and @mentions. It then checks that each one survived. If the model dropped one, it gets one more try. If a fact is still missing, it is added back at the end under "Preserved original details".
- **Nothing is invented.** A vague draft is not padded with made-up requirements. Gaps are marked `(TBD: …)` instead.
- **No runaway length in Light mode.** A Light rewrite may grow to 2× the draft, and always at least 600 characters. A longer result gets one chance to shorten. If it is still too long, it is discarded and your draft is kept. Standard and Detailed modes have no length cap by default (set `standardMaxRatio` to add one).
- **Few model calls per click**: the rewrite, a second rewrite with your answers (only when you answered follow-up questions), and one repair. Each lookup round adds one call, up to **Session lookup rounds** (default 3). Each Stardea click adds one call, plus up to **Stardea search rounds** more (default 1).

## Settings

Open **Settings → Plugins → dsh-smart-prompt** (DSH 0.2 or later).

| Setting | Options |
|---|---|
| **Improvement method** | **Standard**: restructures the draft so an agent can execute it directly. **Detailed (详细模式)**: writes out the ordered next steps, the cautions to watch while executing, and the exact standard for every concrete detail — the prompt sets no length target, so the agent never has to guess one. **Light**: only removes filler and clears up ambiguity. |
| **Model used to improve prompts** | **Conversation model**: uses the model chosen in the current conversation, or your DSH default. **Dedicated model**: always uses the model you pick here, with its own reasoning effort. |
| **Follow-up questions** | The most questions to ask when the draft is missing information. Default 5. |
| **Session lookup rounds** | The most rounds of searching and reading this conversation while rewriting, when the draft depends on something said earlier. 0 to 10, default 3. 0 turns lookups off. |
| **Stardea ideas per click** | The most new suggestions each [Stardea](#stardea-星念) click adds. 1 to 8, default 4. |
| **Stardea search rounds** | The most search rounds each Stardea click may use. 0 to 10, default 1. 0 means Stardea only proposes its own ideas. |
| **Stardea web search** | Lets Stardea search the web with DSH's web search, as well as the conversation. Off by default. Needs **Stardea search rounds** above 0 and a web search provider set up in DSH. |

## Session context

When a draft can't stand on its own, such as "do the same for that endpoint" or a very short draft, the plugin includes the last few turns of the conversation: your messages with the images you attached to them, and the assistant's text replies.

If the draft depends on something said earlier that these turns don't cover, the refining model can search the conversation and read earlier messages, for up to the number of rounds set in **Session lookup rounds**. It can search and read only your messages and the assistant's replies.

Tool results, injected context and source code the agent read are never sent.

## Advanced

### Configuration

Other options live in the profile's `cordis.patch.yml`. All are optional; the values below are the defaults:

```yaml
- insert:
    - id: dsh-smart-prompt
      config:
        lightMaxRatio: 2
        standardMaxRatio: 0        # 0 = no length cap
        acceptanceCriteria: false  # Standard/Detailed: add a checkable "done when" line
        temperature: 0.3
        maxTokens: 8192
        timeoutMs: 180000
        maxInputChars: 20000
        contextTurns: 3            # 0 turns session context off
        contextChars: 6000
        smartContext: true
        knowledgeChars: 4000       # SMART-PROMPT.md size limit; 0 turns it off
        fidelityGate: true
        lengthGate: true
        reasoningEffort: low       # effort used with the conversation model
        logFailures: true
```

### Custom prompts

The rewriting instructions are plain Markdown files in `prompts/`:

- `discipline.md`: the shared rules.
- `standard.md`, `detailed.md` and `light.md`: one file per mode.
- `questions.md`: when and how to ask follow-up questions.
- `answers.md`: how to fold your answers in, including "I don't know".
- `attachments.md`: how to use the draft's attachments and earlier images.
- `session-lookup.md`: when to search the conversation (`{{maxRounds}}` is replaced with the round limit).
- `stardea.md`: how Stardea proposes answer ideas (`{{maxIdeas}}` is replaced with the number of ideas per click, `{{maxRounds}}` with the search rounds per click).

To change them, put a file with the same name in `$DSH_HOME/dsh-smart-prompt/prompts/`. Your file is used instead of the built-in one.

### Local HTTP API

These endpoints accept local connections only:

- `GET /dsh-smart-prompt/api/config` returns the current mode and limits.
- `POST /dsh-smart-prompt/api/improve` with `{ "text": "...", "sessionId": "...", "mode": "standard" }` returns the rewritten text and its quality figures (`meta.usage` holds `{ input, cached, output }` tokens when the provider reports them). An optional `attachments` array takes the composer's attachment wire form: `{ "type": "image", "mediaType": "image/png", "data": "<base64>" }`, or `{ "type": "file", "receiptId": "..." }` for a file already uploaded to that session. With `"interactive": true` and a `sessionId`, the reply may instead be `{ "ok": true, "ask": { "runId": "...", "questions": [{ "id": "q1", "question": "..." }] } }`. The refine then waits for one of these:
  - `POST /dsh-smart-prompt/api/stardea` with `{ "runId", "questionId" }` returns `{ "ok": true, "ideas": [{ "id", "text", "source": "web" | "conversation" | "proposal" }] }`. Only new ideas are returned.
  - `POST /dsh-smart-prompt/api/answer` with `{ "runId", "answers": [{ "id": "q1", "selected": ["idea text"], "custom": "own words" }] }` returns the same result as `/improve`. Send `"answers": []` to skip every question.
  - `POST /dsh-smart-prompt/api/cancel` with `{ "runId" }` ends the refine as cancelled.

## Build from source

```sh
pnpm install
npx tsc -p tsconfig.json   # host half → lib/
npx tsdown                 # browser half → lib/client.js
node --test test/*.test.mjs
```

The built `lib/` is committed, so installing from GitHub needs no build.

## Credits

Forked from [dsh-improve-prompt](https://github.com/hoyyang/dsh-improve-prompt) by hoyyang. See [CONTRIBUTORS](CONTRIBUTORS).

## License

[MIT](LICENSE)
