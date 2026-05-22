# Open Bridge

Open Bridge is a contextual AI workspace for Obsidian.

It connects your notes, selected text, files, folders, AI responses, and local or cloud AI backends, so you can work with AI directly inside your vault without repeatedly copying context into a separate chat window.

The core idea is simple: when you say “this file”, “this paragraph”, or “that AI answer”, Open Bridge helps the AI understand exactly what you are referring to.

## Key Features

- Chat with Claude, Codex, or a custom CLI from inside Obsidian.
- Connect Codex through subscription login or API key model gateways.
- Support OpenAI-compatible providers such as OpenAI, OpenRouter, LiteLLM, One API, Ollama, and private gateways.
- Add files and folders from the Obsidian file explorer as AI context.
- Add selected Markdown text as context, including file path and nearby lines.
- Quote full AI replies, selected AI text, or individual AI paragraphs back into context.
- Manage active context with lightweight context chips.
- Save sessions as Markdown inside the vault for search, review, and long-term memory.
- Show live execution progress for supported CLIs.
- Switch the interface language between Chinese, English, and Japanese.

## Why Open Bridge

Most AI chat plugins start with an empty conversation.

Open Bridge starts from your Obsidian workspace. It is designed for people who organize real work in notes: research, product planning, design decisions, technical documentation, writing drafts, project knowledge, and team memory.

Instead of asking the user to explain everything again, Open Bridge lets the user explicitly attach the current working context.

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
