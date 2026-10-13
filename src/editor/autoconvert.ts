import { Extension, combineTransactionSteps, getChangedRanges } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { ReplaceStep } from '@tiptap/pm/transform'
import { findWikiLinks } from '../core/wikilink'

export const wikiAutoConvertKey = new PluginKey('wikiAutoConvert')

function replacesWholeDocument(tr: Transaction): boolean {
  return tr.steps.some((step, i) => {
    const { from, to } = step as unknown as { from?: number; to?: number }
    return step instanceof ReplaceStep && from === 0 && to === tr.docs[i]!.content.size
  })
}

interface Replacement {
  from: number
  to: number
  embed: boolean
  raw: string
}

interface Range {
  from: number
  to: number
}

/**
 * `[[…]]` runs in one textblock that should become nodes: those this edit
 * touched, or the one the cursor just left. Other `[[…]]` text in the block
 * stays text: it was escaped in the file (`\[\[x\]\]`) and is not a link.
 * The run holding the cursor waits until the cursor leaves.
 */
function scanBlock(
  block: PMNode,
  blockPos: number,
  head: number,
  touched: readonly Range[],
  left: number | null,
): Replacement[] {
  if (block.type.spec.code) return []
  const out: Replacement[] = []
  block.forEach((child, offset) => {
    if (!child.isText || !child.text) return
    // under a mark the link stays text; see WikiMarkdownGuard
    if (child.marks.length) return
    const start = blockPos + 1 + offset
    for (const m of findWikiLinks(child.text)) {
      const from = start + m.index
      const to = from + m.text.length
      // typing inside an unfinished link: leave it alone until the cursor leaves
      if (head > from && head < to) continue
      const edited = touched.some((r) => r.from < to && r.to > from)
      const justLeft = left !== null && left > from && left < to
      if (edited || justLeft) out.push({ from, to, embed: m.embed, raw: m.raw })
    }
  })
  return out
}

function textblocksAround(doc: PMNode, from: number, to: number, into: Map<number, PMNode>): void {
  const lo = Math.max(0, Math.min(from, doc.content.size))
  const hi = Math.max(lo, Math.min(to, doc.content.size))
  doc.nodesBetween(lo, hi, (node, pos) => {
    if (node.isTextblock) {
      into.set(pos, node)
      return false
    }
    return true
  })
  // an empty range still lies inside a block
  const $pos = doc.resolve(lo)
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d)
    if (node.isTextblock) into.set($pos.before(d), node)
  }
}

/**
 * Typed, pasted or reopened `[[Note]]` / `![[image.png]]` text becomes a link
 * or embed node, the same thing a file opened from disk gets.
 */
export const WikiAutoConvert = Extension.create({
  name: 'wikiAutoConvert',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: wikiAutoConvertKey,
        appendTransaction(
          transactions: readonly Transaction[],
          oldState: EditorState,
          newState: EditorState,
        ) {
          if (
            transactions.some(
              (tr) => tr.getMeta(wikiAutoConvertKey) || tr.getMeta('preventAutoConvert'),
            )
          ) {
            return null
          }
          const linkType = newState.schema.nodes.wikiLink
          const embedType = newState.schema.nodes.wikiEmbed
          if (!linkType || !embedType) return null

          // loading a file replaces the whole document; what is text there was escaped on disk
          if (transactions.some(replacesWholeDocument)) return null

          const docChanged = transactions.some((tr) => tr.docChanged)
          const selectionMoved = !oldState.selection.eq(newState.selection)
          if (!docChanged && !selectionMoved) return null

          const blocks = new Map<number, PMNode>()
          const touched: Range[] = []
          const transform = docChanged
            ? combineTransactionSteps(oldState.doc, [...transactions])
            : null
          if (transform) {
            for (const { newRange } of getChangedRanges(transform)) {
              touched.push(newRange)
              textblocksAround(newState.doc, newRange.from, newRange.to, blocks)
            }
          }
          let left: number | null = null
          if (selectionMoved) {
            // the cursor may just have left a run it was holding back
            left = transform
              ? transform.mapping.map(oldState.selection.head)
              : oldState.selection.head
            textblocksAround(newState.doc, left, left, blocks)
          }

          const head = newState.selection.head
          const replacements = [...blocks.entries()].flatMap(([pos, node]) =>
            scanBlock(node, pos, head, touched, left),
          )
          if (!replacements.length) return null

          const tr = newState.tr
          // back to front so earlier positions stay valid
          for (const r of replacements.sort((a, b) => b.from - a.from)) {
            const type = r.embed ? embedType : linkType
            const $from = tr.doc.resolve(r.from)
            if (!$from.parent.inlineContent) continue
            tr.replaceWith(r.from, r.to, type.create({ raw: r.raw }))
          }
          if (!tr.docChanged) return null
          tr.setMeta(wikiAutoConvertKey, true)
          tr.setMeta('addToHistory', true)
          return tr
        },
      }),
    ]
  },
})
