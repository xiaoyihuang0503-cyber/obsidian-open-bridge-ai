# Open Bridge Release Checklist

## Before Publishing

- [ ] Confirm `manifest.json` uses `"id": "open-bridge"`.
- [ ] Confirm `manifest.json` version matches the GitHub release tag.
- [ ] Confirm `versions.json` contains the current version.
- [ ] Replace `authorUrl` with the public repository or author profile.
- [ ] Enable GitHub Pages from the `docs/` folder.
- [ ] Confirm the support page opens: `https://easiao.github.io/obsidian-open-bridge/support/`.
- [ ] Scan-test both WeChat Pay and Alipay QR codes from the support page.
- [ ] Run `node --check main.js`.
- [ ] Test manual install in a clean vault:

```text
.obsidian/plugins/open-bridge/
├── main.js
├── manifest.json
└── styles.css
```

## GitHub Release

Create a release tagged:

```text
0.9.0
```

Attach these files:

```text
main.js
manifest.json
styles.css
```

## Obsidian Community Plugin Submission

Open a pull request to:

```text
obsidianmd/obsidian-releases
```

Add this entry to `community-plugins.json`:

```json
{
  "id": "open-bridge",
  "name": "Open Bridge",
  "author": "easiao",
  "description": "A contextual AI workspace for Obsidian that connects notes, selections, files, and AI CLI/API backends.",
  "repo": "easiao/obsidian-open-bridge"
}
```
