# genoffice-obsidian

Obsidian vault support for the [GenOffice](https://github.com/genspark-ai/genoffice) Markdown editor:

- **Wikilinks**: `[[Note]]`, `[[Note|alias]]`, `[[Note#Heading]]`, `[[Note#^block-id]]`, `[[#Heading]]`, `[[folder/Note]]`. They show as links, and clicking one opens the note in a GenOffice tab. Clicking a link to a note that doesn't exist yet creates it, as Obsidian does.
- **Embeds**: `![[Note]]`, `![[Note#Heading]]`, `![[Note#^block]]`, `![[image.png|300]]`, `![[paper.pdf]]`. These render in place: a note section shows as a quoted preview, an image as an image, and any other file as a chip that opens it.
- **Vault folder**: a Ribbon button opens a sidebar with the vault's folder tree and a search box. Any note inside a folder that has `.obsidian/` attaches to that vault automatically.
- **Your files stay as written**: a note opened and saved without edits keeps every link byte for byte. The tests cover formatting, lists, tables, task lists, math, code and escaped brackets.

Links resolve the way Obsidian resolves them:

- names match case-insensitively
- the shortest path wins, with a note in the linking note's folder preferred
- `folder/Note` matches from the vault root, relative to the linking note, or as a path suffix
- frontmatter `aliases` match too
- attachments need their extension

## Why this is a package plus a patch, not a plugin

GenOffice has no plugin loader, so nothing can be installed into a stock build. This repo holds all of the feature code. `integration/genoffice.patch` holds the ~95 lines that wire it into GenOffice's Markdown app. To use it, apply the patch to your own clone or fork of GenOffice and build that.

## Install into GenOffice

See [INTEGRATION.md](INTEGRATION.md). The short version, from a GenOffice checkout:

```sh
git apply /path/to/genoffice-obsidian/integration/genoffice.patch
npm install
npm run dev        # or: npm run build:all && electron apps/shell
```

## Layout

| Path | Runs in | What it does |
| --- | --- | --- |
| `src/core/` | anywhere | link parsing, the resolver (`VaultIndex`), heading/block extraction, the renderer-side `VaultStore` |
| `src/editor/` | renderer | Tiptap nodes `wikiLink` / `wikiEmbed`, their Markdown tokenizers and serializers, typed-link conversion, embed rendering, styles |
| `src/react/` | renderer | `VaultSidebar` |
| `src/main/` | main process | `VaultService` (listing, path containment, file watching) and the IPC handlers |
| `src/preload/` | preload | `window.obsidianVault` bridge |
| `integration/` | — | the GenOffice patch |

## Behaviour notes

- **Editing a link**: press Backspace right after a link to turn it back into text (`[[Note]`). Edit it, then type `]` to make it a link again. Typing a complete `[[…]]` converts it as soon as the brackets close.
- **Links inside bold, italic or strikethrough** (`**see [[Note]]**`) stay as text, styled as links. Open them with Cmd/Ctrl-click. Tiptap's Markdown serializer closes formatting around inline nodes, so turning these into nodes would rewrite `**see [[Note]]**` as `**see** [[Note]]` on save.
- **Security**: the main process only serves files inside the attached vault. It rejects `..`, absolute paths and symlinks that point outside the vault, and it only reads notes and images, never other file types. Embedded note HTML is sanitized: no scripts, event handlers or `javascript:` URLs.
- **Large vaults**: the listing stops at 20,000 files and the sidebar says so. Notes over 5 MB and images over 25 MB are not loaded.
- **Not included yet**: autocomplete while typing `[[`, backlinks, renaming a note and updating the links to it, and Obsidian's `%%comments%%` / callouts / Canvas.

## Develop

```sh
pnpm install
pnpm test        # 51 tests: parser, resolver, sections, editor round-trip, embeds, main-process path safety
pnpm typecheck
```

The patch also adds `apps/markdown/tests/obsidian-links.test.ts` to GenOffice. That test runs the links through GenOffice's real extension list (`SelectiveEscapeMarkdown`, tables, math).

License: Apache-2.0, same as GenOffice.
