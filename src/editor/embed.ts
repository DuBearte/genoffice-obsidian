import type { Editor } from '@tiptap/core'
import DOMPurify from 'dompurify'
import { Marked, type TokenizerAndRendererExtension } from 'marked'
import { embedFragment } from '../core/sections'
import { isImage, isNote } from '../core/vault-index'
import type { VaultStore } from '../core/vault-store'
import { displayText, matchWikiLinkAt, parseEmbedSize, parseWikiLink } from '../core/wikilink'
import { followLink, reportError } from './follow'
import type { ObsidianEditorOptions } from './options'

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/**
 * A marked instance for the read-only preview inside an embed. Links inside the
 * embedded note become clickable chips; nested image embeds load after the
 * HTML is in place; nested note embeds stay links, which keeps a note that
 * embeds itself from recursing.
 */
function previewRenderer(store: VaultStore, fromPath: string | null): Marked {
  const wiki = (embed: boolean): TokenizerAndRendererExtension => ({
    name: embed ? 'wikiEmbed' : 'wikiLink',
    level: 'inline',
    start: (src) => {
      const i = src.indexOf(embed ? '![[' : '[[')
      return i < 0 ? undefined : i
    },
    tokenizer(src) {
      const m = matchWikiLinkAt(src)
      if (!m || m.embed !== embed) return undefined
      return { type: embed ? 'wikiEmbed' : 'wikiLink', raw: m.text, text: m.raw }
    },
    renderer(token) {
      const raw = String(token.text)
      const parts = parseWikiLink(raw)
      const file = parts.target ? store.links.resolve(parts.target, fromPath) : null
      if (embed && file && isImage(file.path)) {
        const size = parseEmbedSize(parts.alias)
        const dims = size
          ? ` width="${size.width}"${size.height ? ` height="${size.height}"` : ''}`
          : ''
        return `<img data-vault-image="${escapeHtml(file.path)}" alt="${escapeHtml(parts.target)}"${dims}>`
      }
      const cls = file || !parts.target ? 'obsidian-link' : 'obsidian-link is-unresolved'
      return `<a class="${cls}" data-wikilink="${escapeHtml(raw)}">${escapeHtml(displayText(parts))}</a>`
    },
  })
  return new Marked({
    gfm: true,
    breaks: false,
    async: false,
    extensions: [wiki(true), wiki(false)],
  })
}

/**
 * Notes are the user's own files, but a vault can come from anyone: no
 * scripts, handlers, styles, forms or non-web URLs in the editor. DOMPurify
 * also covers the SVG/MathML tricks a hand-written filter misses.
 */
export function sanitizeInto(container: HTMLElement, html: string): void {
  const fragment = DOMPurify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'svg', 'math'],
    FORBID_ATTR: ['style', 'srcset'],
  })
  // relative links (`[x](other.md)`) would navigate the editor itself away;
  // only web and mail links stay, and they open outside (see renderEmbed)
  for (const el of fragment.querySelectorAll('[href], [src]')) {
    for (const name of ['href', 'src']) {
      const value = el.getAttribute(name)
      if (value !== null && !/^(?:https?:|mailto:)/i.test(value.trim())) el.removeAttribute(name)
    }
  }
  container.replaceChildren(fragment)
}

function chip(label: string, className: string, onClick?: () => void): HTMLElement {
  const el = document.createElement(onClick ? 'button' : 'span')
  el.className = className
  el.textContent = label
  if (onClick) {
    ;(el as HTMLButtonElement).type = 'button'
    el.addEventListener('click', (e) => {
      e.preventDefault()
      onClick()
    })
  }
  return el
}

export async function renderEmbed(
  dom: HTMLElement,
  raw: string,
  editor: Editor,
  options: ObsidianEditorOptions,
  isCurrent: () => boolean,
): Promise<void> {
  const { store } = options
  const parts = parseWikiLink(raw)
  const from = store.currentNote
  const file = parts.target ? store.resolve(parts.target) : null
  const open = () => void followLink(editor, parts, options).catch(reportError)
  dom.className = 'obsidian-embed'
  dom.dataset.kind = ''
  // the files this embed shows; a save of one of them reloads it
  dom.dataset.deps = file ? file.path : ''

  if (!store.vault) {
    dom.dataset.kind = 'detached'
    dom.replaceChildren(chip(`![[${raw}]]`, 'obsidian-embed-source'))
    dom.title = 'Open the Obsidian vault this note belongs to to show the embed'
    return
  }
  if (!file) {
    dom.dataset.kind = 'unresolved'
    dom.replaceChildren(
      chip(`${displayText(parts) || raw} — not created yet`, 'obsidian-embed-missing', open),
    )
    return
  }
  if (file.path === from && !parts.heading && !parts.block) {
    dom.dataset.kind = 'unresolved'
    dom.replaceChildren(chip('A note cannot embed itself', 'obsidian-embed-missing'))
    return
  }

  if (isImage(file.path)) {
    dom.dataset.kind = 'image'
    const url = await store.client.readImage(file.path).catch(() => null)
    if (!isCurrent()) return
    if (!url) {
      dom.replaceChildren(chip(`${file.path} could not be loaded`, 'obsidian-embed-missing'))
      return
    }
    const img = document.createElement('img')
    img.src = url
    img.alt = parts.alias && !parseEmbedSize(parts.alias) ? parts.alias : file.path
    const size = parseEmbedSize(parts.alias)
    if (size?.width) img.width = size.width
    if (size?.height) img.height = size.height
    img.draggable = false
    dom.replaceChildren(img)
    return
  }

  if (!isNote(file.path)) {
    // PDFs, audio, video, canvases: GenOffice opens what it can in its own tab
    dom.dataset.kind = 'file'
    dom.replaceChildren(chip(`📎 ${file.path}`, 'obsidian-embed-file', open))
    return
  }

  dom.dataset.kind = 'note'
  const header = chip(displayText({ ...parts, alias: null }), 'obsidian-embed-title', open)
  const body = document.createElement('div')
  body.className = 'obsidian-embed-body'
  body.textContent = 'Loading…'
  dom.replaceChildren(header, body)

  let text: string
  try {
    text = await store.readText(file.path)
  } catch {
    if (isCurrent()) body.textContent = `${file.path} could not be read`
    return
  }
  if (!isCurrent()) return
  const fragment = embedFragment(text, parts)
  if (fragment === null) {
    body.textContent = parts.block
      ? `Block ^${parts.block} not found in ${file.path}`
      : `Heading "${parts.heading}" not found in ${file.path}`
    return
  }
  const html = previewRenderer(store, file.path).parse(fragment) as string
  sanitizeInto(body, html)

  for (const a of body.querySelectorAll<HTMLAnchorElement>('a[data-wikilink]')) {
    a.addEventListener('click', (e) => {
      e.preventDefault()
      const linkParts = parseWikiLink(a.dataset.wikilink ?? '')
      // links inside the embed resolve from the embedded note, not this one
      const target = linkParts.target ? store.links.resolve(linkParts.target, file.path) : file
      void followLink(
        editor,
        { ...linkParts, target: target?.path ?? linkParts.target },
        options,
      ).catch(reportError)
    })
  }
  for (const a of body.querySelectorAll<HTMLAnchorElement>('a[href^="http"]')) {
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
  }
  const images = [...body.querySelectorAll<HTMLImageElement>('img[data-vault-image]')]
  dom.dataset.deps = [file.path, ...images.map((img) => img.dataset.vaultImage!)].join('\n')
  await Promise.all(
    images.map(async (img) => {
      const url = await store.client.readImage(img.dataset.vaultImage!).catch(() => null)
      if (url && isCurrent()) img.src = url
    }),
  )
}
