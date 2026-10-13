# Wiring genoffice-obsidian into GenOffice

The patch in `integration/genoffice.patch` targets GenOffice release `v0.11.727` (October 2026). On that release:

- it applies cleanly
- `tsc` passes
- `electron-vite build` passes
- all 1,108 Markdown tests pass except one, `close-asset-cleanup` › "resolves source pending ownership…". That test also fails on the unmodified release.

If GenOffice has moved on and the patch no longer applies, the changes are small enough to make by hand:

## 1. Dependency and bundling: `apps/markdown`

`package.json`:

```json
"dependencies": {
  "genoffice-obsidian": "github:DuBearte/genoffice-obsidian",
```

`electron.vite.config.ts`: the package ships TypeScript source, like `@genoffice/i18n`, so main and preload must bundle it rather than externalize it:

```ts
externalizeDepsPlugin({
  exclude: ['@genoffice/i18n', '@genoffice/electron-utils', 'genoffice-obsidian'],
})
```

The shell needs no change. Its main build already bundles everything, `markdown-main.ts` included.

## 2. Main process: `src/main/markdown-main.ts`

```ts
import { registerObsidianVaultIpc } from 'genoffice-obsidian/main'

function registerMarkdownIpc(): void {
  if (ipcRegistered) return
  ipcRegistered = true

  // Obsidian vaults: [[wikilinks]], ![[embeds]] and the vault sidebar
  registerObsidianVaultIpc()
```

This call registers the `obsidian-vault:*` IPC handlers. It stores the last opened vault in `userData/obsidian-vault.json`.

## 3. Preload: `src/preload/index.ts`

```ts
import { exposeObsidianVault } from 'genoffice-obsidian/preload'
// after the existing exposeInMainWorld calls:
exposeObsidianVault()
```

## 4. Editor extensions: `src/renderer/editor/extensions.ts`

```ts
import { obsidianExtensions, type ObsidianEditorOptions } from 'genoffice-obsidian/editor'
// import renderingTable alongside SelectiveEscapeMarkdown from './markdownEscape'

export interface BuildExtensionsOptions {
  // …
  obsidian?: Omit<ObsidianEditorOptions, 'isInTable'>
}

// at the END of the returned array; the Markdown guard wraps SelectiveEscapeMarkdown's patch:
...(options.obsidian ? obsidianExtensions({ ...options.obsidian, isInTable: renderingTable }) : []),
```

## 5. App: `src/renderer/App.tsx`, `Ribbon.tsx`, `icons.tsx`, `main.tsx`, `styles.css`

- Create one `VaultStore` per tab from `window.obsidianVault`, and pass `{ store, openPath: window.markdownApi.openSourcePath }` to `buildExtensions`.
- Call `vaultStore.setDocumentPath(filePath)` whenever `filePath` changes. This is what attaches a note to its vault and lets links resolve relative to it.
- Render `<VaultSidebar store={vaultStore} openPath={…} />` in an `.md-vault` column next to the outline.
- Add a Ribbon toggle (`IconVault`) after the Outline button. Its label is the English string "Obsidian vault". To translate it, add a key to `i18n/strings.ts`.
- `import 'genoffice-obsidian/styles.css'` in `main.tsx`. Links pick up the `--accent` color through `--obsidian-link`.

## Trying it

1. `npm install` at the GenOffice root, then `npm run dev`.
2. Open any `.md` file inside an Obsidian vault. The vault attaches on its own because the file sits under a folder with `.obsidian/`. Or click the vault button in the Ribbon and choose **Open vault folder…**.
3. Type `[[` and a note name, then `]]`. Click the link to open that note in a new tab.
4. Type `![[Some note#A heading]]` or `![[picture.png|300]]` on its own line to see an embed.
