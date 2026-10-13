import { expect, it } from 'vitest'
import { sanitizeInto } from '../src/editor/embed'
it('blocks scriptable payloads', () => {
  const box = document.createElement('div')
  sanitizeInto(
    box,
    '<svg><a><animate attributeName="href" values="javascript:alert(1)"/><text y="20">x</text></a></svg><math><a href="javascript:alert(2)">m</a></math><a href="https://ok.example">ok</a><a class="obsidian-link" data-wikilink="Home">Home</a><img data-vault-image="p.png">',
  )
  const html = box.innerHTML
  expect(html).not.toMatch(/javascript:/i)
  expect(box.querySelector('a[href="https://ok.example"]')).not.toBeNull()
  expect(box.querySelector('a[data-wikilink="Home"]')).not.toBeNull()
  expect(box.querySelector('img[data-vault-image="p.png"]')).not.toBeNull()
})

it('drops relative links that would navigate the editor away', () => {
  const box = document.createElement('div')
  sanitizeInto(
    box,
    '<a href="other.md">x</a><a href="file:///etc/passwd">y</a><img src="pic.png" width="40">',
  )
  expect(box.querySelectorAll('[href]')).toHaveLength(0)
  expect(box.querySelector('img')!.getAttribute('src')).toBeNull()
  expect(box.querySelector('img')!.getAttribute('width')).toBe('40')
})
