import { Extension, type JSONContent } from '@tiptap/core'
import { findWikiLinks } from '../core/wikilink'

type MarkSpec = string | { type: string }
type TextNode = { type?: string; text?: string; marks?: MarkSpec[] }

interface MarkdownManagerSeams {
  applyMarkToContent: (markType: string, content: JSONContent[], attrs?: unknown) => JSONContent[]
  encodeTextForMarkdown: (text: string, node: TextNode, parent?: TextNode) => string
}

const markName = (m: MarkSpec) => (typeof m === 'string' ? m : m.type)

/** a link or embed node that ended up under a mark goes back to being its source text */
function textify(node: JSONContent): JSONContent {
  if (node.type === 'wikiLink' || node.type === 'wikiEmbed') {
    const prefix = node.type === 'wikiEmbed' ? '!' : ''
    return {
      type: 'text',
      text: `${prefix}[[${node.attrs?.raw ?? ''}]]`,
      ...(node.marks ? { marks: node.marks } : {}),
    }
  }
  return node.content ? { ...node, content: node.content.map(textify) } : node
}

/**
 * `@tiptap/markdown` closes every open mark around a non-text inline node, so a
 * link node inside `**bold [[Note]]**` would be saved as `**bold** [[Note]]`.
 * Links under a mark therefore stay text (`WikiTextLinks` makes them
 * clickable), and the serializer writes that text verbatim instead of
 * escaping its brackets.
 *
 * Unmarked `[[…]]` text only exists when the file escaped it (`\[\[x\]\]`);
 * it is written escaped again so it does not turn into a link on reopen.
 *
 * Patches the manager the same way GenOffice's `SelectiveEscapeMarkdown`
 * does, and must come after it in the extension list (it wraps that patch).
 */
export const WikiMarkdownGuard = Extension.create({
  name: 'wikiMarkdownGuard',

  onBeforeCreate() {
    const manager = (this.editor as unknown as { markdown?: MarkdownManagerSeams }).markdown
    if (!manager) return

    const apply = manager.applyMarkToContent.bind(manager)
    manager.applyMarkToContent = (markType, content, attrs) =>
      apply(markType, content.map(textify), attrs)

    const encode = manager.encodeTextForMarkdown.bind(manager)
    manager.encodeTextForMarkdown = (text, node, parent) => {
      const marks = (node.marks ?? []).map(markName)
      const inCode = marks.includes('code') || parent?.type === 'codeBlock'
      if (inCode || !text.includes('[[')) return encode(text, node, parent)
      if (!marks.length) {
        return encode(text, node, parent).replace(/(?<!\\)\[\[/g, '\\[\\[')
      }
      const links = findWikiLinks(text)
      if (!links.length) return encode(text, node, parent)
      let out = ''
      let at = 0
      for (const link of links) {
        if (link.index > at) out += encode(text.slice(at, link.index), node, parent)
        out += link.text
        at = link.index + link.text.length
      }
      if (at < text.length) out += encode(text.slice(at), node, parent)
      return out
    }
  },
})
