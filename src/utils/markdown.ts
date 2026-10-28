/**
 * AI 回复的富文本渲染：Markdown → 安全 HTML
 *
 * 安全策略：marked 输出的 HTML 一律过一遍白名单清洗（自写 sanitize），
 * 只保留排版需要的标签和 href/src/class 三个属性，脚本/事件/on* 全部丢掉，
 * 因为内容来自第三方模型，不能信。
 */
import { Marked } from 'marked'
import hljs from 'highlight.js/lib/common'

const ALLOWED_TAGS = new Set([
  'P', 'BR', 'HR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'STRONG', 'EM', 'DEL', 'CODE', 'PRE', 'BLOCKQUOTE',
  'UL', 'OL', 'LI', 'A', 'IMG', 'SPAN', 'DIV',
  'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD',
  'VIDEO', 'SOURCE'
])
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  A: new Set(['href', 'target', 'rel', 'class']),
  IMG: new Set(['src', 'alt', 'class', 'title']),
  VIDEO: new Set(['src', 'controls', 'class', 'muted', 'loop', 'poster']),
  SOURCE: new Set(['src', 'type']),
  CODE: new Set(['class']),
  PRE: new Set(['class']),
  DIV: new Set(['class']),
  SPAN: new Set(['class']),
  TH: new Set(['align']),
  TD: new Set(['align'])
}

function sanitize(html: string): string {
  const doc = new DOMParser().parseFromString(`<body><div id="__md">${html}</div></body>`, 'text/html')
  const root = doc.getElementById('__md')
  if (!root) return ''

  const walk = (el: Element): void => {
    for (const child of Array.from(el.children)) {
      walk(child)
      if (!ALLOWED_TAGS.has(child.tagName)) {
        // 不在白名单：保留文字内容，丢掉标签本身
        const text = doc.createTextNode(child.textContent || '')
        child.replaceWith(text)
        continue
      }
      const allow = ALLOWED_ATTRS[child.tagName] || new Set<string>()
      for (const attr of Array.from(child.attributes)) {
        if (!allow.has(attr.name.toLowerCase())) child.removeAttribute(attr.name)
      }
      if (child.tagName === 'A') {
        const href = child.getAttribute('href') || ''
        if (!/^(https?:|mailto:|#|\/|data:image\/)/i.test(href)) child.removeAttribute('href')
        child.setAttribute('target', '_blank')
        child.setAttribute('rel', 'noreferrer noopener')
      }
      if (child.tagName === 'IMG') {
        const src = child.getAttribute('src') || ''
        if (!/^(https?:|data:image\/|\/)/i.test(src)) child.removeAttribute('src')
        child.setAttribute('class', 'md-img')
      }
      if (child.tagName === 'VIDEO') {
        const src = child.getAttribute('src') || ''
        if (!/^(https?:|data:video\/|\/)/i.test(src)) child.removeAttribute('src')
        child.setAttribute('controls', '')
        child.setAttribute('class', 'md-video')
      }
    }
  }
  walk(root)
  return root.innerHTML
}

const marked = new Marked({ gfm: true, breaks: true })

/** 代码块高亮 + 语言标签 */
marked.use({
  renderer: {
    code({ text, lang }) {
      const language = (lang || '').trim().split(/\s+/)[0]
      let body = text
      let ok = false
      if (language && hljs.getLanguage(language)) {
        try {
          body = hljs.highlight(text, { language }).value
          ok = true
        } catch {
          ok = false
        }
      }
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      return `<div class="md-code"><div class="md-code-head"><span class="md-code-lang">${esc(language || (ok ? '' : 'text'))}</span></div><pre><code class="hljs language-${esc(language)}">${ok ? body : esc(body)}</code></pre></div>`
    }
  }
})

/** 把裸链接里的视频文件（.mp4/.webm/.ogg）渲染成 <video> */
function videoPass(md: string): string {
  return md.replace(/(^|[\s(])(https?:\/\/[^\s)]+\.(?:mp4|webm|ogg|mov))(?=[\s)]|$)/gim, (_m, pre: string, url: string) => {
    return `${pre}<video src="${url}" controls muted loop playsinline></video>`
  })
}

export function renderMarkdown(src: string): string {
  if (!src) return ''
  try {
    const html = marked.parse(videoPass(src), { async: false }) as string
    return sanitize(html)
  } catch {
    return sanitize(`<p>${src.replace(/</g, '&lt;')}</p>`)
  }
}

/** 流式输出时可能截在半个代码块里：结尾未闭合就先不渲染成代码 */
export function isInsideFence(text: string): boolean {
  const n = (text.match(/```/g) || []).length
  return n % 2 === 1
}
