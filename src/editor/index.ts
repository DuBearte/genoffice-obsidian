import type { AnyExtension } from '@tiptap/core'
import { WikiAutoConvert } from './autoconvert'
import type { ObsidianEditorOptions } from './options'
import { WikiMarkdownGuard } from './markdown-guard'
import { createWikiTextLinks } from './text-links'
import { createWikiNodes } from './wikilink'

export type { ObsidianEditorOptions } from './options'
export { followLink, scrollToHeading, scrollToBlock } from './follow'
export { sanitizeInto } from './embed'
export { WikiAutoConvert, wikiAutoConvertKey } from './autoconvert'
export { createWikiNodes } from './wikilink'
export { WikiMarkdownGuard } from './markdown-guard'
export { createWikiTextLinks, wikiTextLinksKey } from './text-links'

/**
 * Everything the editor needs for Obsidian links. Append the result to the end
 * of GenOffice's `buildExtensions` list: the Markdown guard wraps the escaping
 * that `SelectiveEscapeMarkdown` installs, so it has to come after it.
 */
export function obsidianExtensions(options: ObsidianEditorOptions): AnyExtension[] {
  const { WikiLink, WikiEmbed } = createWikiNodes(options)
  return [WikiLink, WikiEmbed, WikiAutoConvert, WikiMarkdownGuard, createWikiTextLinks(options)]
}
