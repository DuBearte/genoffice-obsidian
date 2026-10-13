import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { headingKey } from '../core/sections'
import type { WikiLinkParts } from '../core/wikilink'
import type { ObsidianEditorOptions } from './options'

/** link clicks are fire-and-forget; a failure (file gone, path refused) is logged, not thrown */
export function reportError(error: unknown): void {
  console.warn('[genoffice-obsidian]', error)
}

/** Open what a link points at: another note in a tab, a heading in this note, or a new note */
export async function followLink(
  editor: Editor,
  parts: WikiLinkParts,
  options: ObsidianEditorOptions,
): Promise<void> {
  const { store } = options
  const current = store.currentNote
  const file = store.resolve(parts.target)

  if (!parts.target || (file && current && file.path === current)) {
    if (parts.heading) scrollToHeading(editor, parts.heading)
    else if (parts.block) scrollToBlock(editor, parts.block)
    return
  }
  if (!store.vault) return
  if (file) {
    await options.openPath(await store.client.absolutePath(file.path))
    return
  }
  // only a note inside the vault creates notes there; a stray file outside it does not
  if (options.createMissingNotes === false || current === null) return
  const name = parts.target.replace(/^\/+/, '')
  const path = /\.(md|markdown)$/i.test(name) ? name : `${name}.md`
  await options.openPath(await store.client.createNote(path))
}

function scrollTo(editor: Editor, pos: number): void {
  const { state, view } = editor
  view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(pos))).scrollIntoView())
  view.focus()
}

export function scrollToHeading(editor: Editor, headingPath: string): boolean {
  const wanted = headingKey(headingPath.split('#').pop() ?? '')
  let target: number | null = null
  editor.state.doc.descendants((node, pos) => {
    if (target !== null) return false
    if (node.type.name === 'heading' && headingKey(node.textContent) === wanted) target = pos + 1
    return node.isBlock
  })
  if (target === null) return false
  scrollTo(editor, target)
  return true
}

export function scrollToBlock(editor: Editor, id: string): boolean {
  let target: number | null = null
  editor.state.doc.descendants((node, pos) => {
    if (target !== null) return false
    if (node.isTextblock && node.textContent.trimEnd().endsWith(`^${id}`)) target = pos + 1
    return node.isBlock
  })
  if (target === null) return false
  scrollTo(editor, target)
  return true
}
