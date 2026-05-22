# Open Bridge

Open Bridge is a contextual AI workspace for Obsidian.

It connects notes, selected text, files, folders, AI responses, and local or cloud AI backends, so you can work with AI inside your vault without repeatedly copying context into a separate chat window.

The core idea is simple: when you say "this file", "this paragraph", or "that AI answer", Open Bridge helps the AI understand exactly what you are referring to.

## Key Features

- Chat with Claude, Codex, or a custom CLI from inside Obsidian.
- Connect Codex through subscription login or API key model gateways.
- Support OpenAI-compatible providers such as OpenAI, OpenRouter, LiteLLM, One API, Ollama, and private gateways.
- Add files and folders from the file explorer as AI context.
- Add selected Markdown text as context, including file path and nearby lines.
- Quote full AI replies, selected AI text, or individual AI paragraphs back into context.
- Manage active context with lightweight context chips.
- Save sessions as Markdown inside the vault for search, review, and long-term memory.
- Show live execution progress for supported CLIs.
- Switch the interface language between Chinese, English, and Japanese.

## Why Open Bridge

Most AI chat plugins start with an empty conversation.

Open Bridge starts from your workspace. It is designed for people who organize real work in notes: research, product planning, design decisions, technical documentation, writing drafts, project knowledge, and team memory.

Instead of asking the user to explain everything again, Open Bridge lets the user explicitly attach the current working context.

<img width="1148" height="1408" alt="Open Bridge context workflow" src="https://github.com/user-attachments/assets/9da2afeb-05f5-4c6d-b7f5-e5540f79f18e" />

## Installation

### Community plugin install

After the plugin is accepted into the community plugin directory:

1. Open Settings.
2. Go to Community plugins.
3. Choose Browse.
4. Search for Open Bridge.
5. Install and enable the plugin.

### Manual install

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release.
2. Create this folder in your vault:

```text
.obsidian/plugins/open-bridge/
```

3. Put the three files into that folder.
4. Restart Obsidian or reload community plugins.
5. Enable Open Bridge in Settings -> Community plugins.

## Usage

1. Open the Open Bridge view from the ribbon icon or command palette.
2. Choose a backend: Claude, Codex, or Custom.
3. Add context before asking:
   - Right-click a file or folder and choose Add to Open Bridge context.
   - Select Markdown text, then right-click and choose Add selection to Open Bridge context.
   - Quote a full AI answer, selected AI text, or one AI paragraph back into context.
4. Ask your question in the chat box. The active context is sent together with your message.
5. Start a new session when switching topics, or continue the current session when you want the AI to remember the previous discussion.

## Context Workflow

Open Bridge is designed around explicit context references.

You can:

- Right-click a file or folder and add it to Open Bridge context.
- Select text in a Markdown file and add it to context.
- Quote an entire AI response back into context.
- Select part of an AI response and quote only that fragment.
- Hover an AI paragraph and quote that paragraph as context.

The next message automatically includes the active context, so short follow-up prompts become useful:

```text
Summarize this.
Rewrite this paragraph.
Compare these two files.
Continue from that answer.
Turn this into a clearer product note.
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

## Language

Open Bridge supports Chinese, English, and Japanese interface text.

Change it from:

```text
Settings -> Open Bridge -> Interface language
```

## Commands

- New Open Bridge chat
- Reveal Open Bridge chat
- Open Bridge chat in current pane
- Add current file to Open Bridge context
- Add selection to Open Bridge context
- Resume AI session
- Configure model gateway
- Reload Open Bridge

## Release Files

Each GitHub release should attach:

```text
main.js
manifest.json
styles.css
```

The release tag must match the `version` in `manifest.json`.

## License

MIT
