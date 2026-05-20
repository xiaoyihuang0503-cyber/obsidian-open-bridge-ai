# Open Bridge

Open Bridge turns Obsidian into a contextual AI workspace. It connects notes, selected text, files, folders, and AI outputs to local AI CLIs or OpenAI-compatible model gateways.

It is built for people who work inside a knowledge base and need the AI to understand "this file", "this paragraph", "that answer", and the surrounding project context.

## Features

- Chat with Claude, Codex, or a custom CLI from inside Obsidian.
- Connect Codex through either subscription login or API key model gateways.
- Use OpenAI-compatible providers such as OpenAI, OpenRouter, LiteLLM, One API, Ollama, and private gateways.
- Add files and folders from the Obsidian file explorer as AI context.
- Add selected Markdown text as context, including file path and nearby lines.
- Quote full AI replies, selected AI text, or individual AI paragraphs back into context.
- Save sessions as Markdown inside the vault for search, review, and long-term memory.
- Show live execution progress for supported CLIs.

## Installation

### Manual install

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release.
2. Create this folder in your vault:

```text
.obsidian/plugins/open-bridge/
```

3. Put the three files into that folder.
4. Restart Obsidian or reload community plugins.
5. Enable **Open Bridge** in Settings -> Community plugins.

### Community plugin install

After the plugin is accepted into the Obsidian community plugin directory, install it from:

```text
Settings -> Community plugins -> Browse -> Open Bridge
```

## Model Setup

Open Bridge supports two Codex connection modes:

| Mode | Best For | What You Need |
|---|---|---|
| Subscription / Codex CLI Login | Users already logged into Codex App or Codex CLI | Run `codex login` locally |
| API Key / Model Gateway | OpenAI, OpenRouter, LiteLLM, Ollama, private gateways | Base URL, model name, optional API key |

Open the setup wizard from:

```text
Settings -> Open Bridge -> Model gateway setup
```

or type:

```text
/setup
```

## Context Workflow

Open Bridge is designed around explicit context chips.

- Right-click a file or folder -> **Add to Open Bridge context**.
- Select text in a Markdown file -> right-click -> **Add selection to Open Bridge context**.
- Hover an AI paragraph -> click the quote button to reuse it as context.
- Select part of an AI answer -> click quote to cite only that fragment.

The next message automatically includes the active context, so you can ask short follow-ups like:

```text
Summarize this.
Rewrite this paragraph.
Continue from that direction.
Compare these two files.
```

## Commands

- `New Open Bridge chat`
- `Reveal Open Bridge chat`
- `Open Bridge chat in current pane`
- `Add current file to Open Bridge context`
- `Add selection to Open Bridge context`
- `Resume AI session`
- `Configure model gateway`
- `Reload Open Bridge`

## Release Files

Each GitHub release should attach:

```text
main.js
manifest.json
styles.css
```

The release tag must match the `version` in `manifest.json`.

## Support

If Open Bridge saves you time, you can support development here:

- Support page: https://easiao.github.io/obsidian-open-bridge/support/

The support page includes privacy-masked WeChat Pay and Alipay QR codes using the public name **Hsiao Evan**.

## License

MIT
