/**
 * Markdown 渲染工具
 */

import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: true,
})

const defaultLinkOpen = md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => {
  return self.renderToken(tokens, idx, options)
})

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  token.attrSet('target', '_blank')
  token.attrSet('rel', 'noopener noreferrer')
  return defaultLinkOpen(tokens, idx, options, env, self)
}

export function renderMarkdown(text: string): string {
  return md.render(text)
}
