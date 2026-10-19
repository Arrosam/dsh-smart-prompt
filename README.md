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

### Follow-up questions

If the draft is missing something only you can answer (which endpoint, what limit, which option), DSH's question card opens in place of the composer with a few short questions. Answer them and the prompt is rewritten again with your answers included.

- Answer "I don't know" and the prompt tells the agent to find it out itself, or to suggest options and carry on with the most reasonable one.
- Skip a question or close the card, and you get the first rewrite with `(TBD: …)` notes for the gaps.
- If the request fails after you answered, click **Retry** on the error bubble. Your answers are reused, so you are not asked again.
- No questions are asked when the draft already has what it needs.

## What it guarantees

- **Nothing important is lost.** Before rewriting, the plugin lists the hard facts in your draft: file paths, identifiers, numbers and versions, URLs, `code`, and @mentions. It then checks that each one survived. If the model dropped one, it gets one more try. If a fact is still missing, it is added back at the end under "Preserved original details".
- **Nothing is invented.** A vague draft is not padded with made-up requirements. Gaps are marked `(TBD: …)` instead.
- **No runaway length in Light mode.** A Light rewrite may grow to 2× the draft, and always at least 600 characters. A longer result gets one chance to shorten. If it is still too long, it is discarded and your draft is kept. Standard mode has no length cap by default (set `standardMaxRatio` to add one).
- **At most three model calls per click**: the rewrite, a second rewrite with your answers (only when you answered follow-up questions), and one repair.

## Settings

Open **Settings → Plugins → dsh-smart-prompt** (DSH 0.2 or later).

| Setting | Options |
|---|---|
| **Improvement method** | **Standard**: restructures the draft so an agent can execute it directly. **Light**: only removes filler and clears up ambiguity. |
| **Model used to improve prompts** | **Conversation model**: uses the model chosen in the current conversation, or your DSH default. **Dedicated model**: always uses the model you pick here, with its own reasoning effort. |
| **Follow-up questions** | The most questions to ask when the draft is missing information. Default 5. |

## Session context

When a draft can't stand on its own, such as "do the same for that endpoint" or a very short draft, the plugin includes the last few turns of the conversation. Only your messages and the assistant's text replies are sent. Tool results, images and source code are not.

## Advanced

### Configuration

Other options live in the profile's `cordis.patch.yml`. All are optional; the values below are the defaults:

```yaml
- insert:
    - id: dsh-smart-prompt
      config:
        lightMaxRatio: 2
        standardMaxRatio: 0        # 0 = no length cap
        acceptanceCriteria: false  # Standard: add a checkable "done when" line
        temperature: 0.3
        maxTokens: 8192
        timeoutMs: 180000
        maxInputChars: 20000
        contextTurns: 3            # 0 turns session context off
        contextChars: 6000
        smartContext: true
        fidelityGate: true
        lengthGate: true
        reasoningEffort: low       # effort used with the conversation model
        logFailures: true
```

### Custom prompts

The rewriting instructions are plain Markdown files in `prompts/`:

- `discipline.md`: the shared rules.
- `standard.md` and `light.md`: one file per mode.
- `questions.md`: when and how to ask follow-up questions.
- `answers.md`: how to fold your answers in, including "I don't know".

To change them, put a file with the same name in `$DSH_HOME/dsh-smart-prompt/prompts/`. Your file is used instead of the built-in one.

### Local HTTP API

These endpoints accept local connections only:

- `GET /dsh-smart-prompt/api/config` returns the current mode and limits.
- `POST /dsh-smart-prompt/api/improve` with `{ "text": "...", "sessionId": "...", "mode": "standard" }` returns the rewritten text and its quality figures.

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
