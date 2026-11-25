import { ReactNode, isValidElement, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import { Check, Copy } from 'lucide-react'

function extractText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (isValidElement(node)) return extractText(node.props?.children)
  return ''
}

function CodeBlock({ children }: { children: ReactNode }) {
  const [copied, setCopied] = useState(false)
  const child = isValidElement(children) ? children : null
  const cls = typeof child?.props?.className === 'string' ? child.props.className : ''
  const lang = cls.replace(/^language-/, '') || 'code'
  const raw = extractText(children).replace(/\n$/, '')

  function copy() {
    navigator.clipboard?.writeText(raw).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    }).catch(() => undefined)
  }

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-slate-800 bg-slate-950 shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-800/80 bg-slate-900/80 px-3.5 py-1.5 text-[11px] font-medium text-slate-400">
        <span className="font-mono uppercase tracking-wider">{lang}</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-slate-300 transition hover:bg-slate-800 hover:text-white"
          aria-label="Copy code"
        >
          {copied ? <><Check className="h-3 w-3 text-emerald-400" />Copied</> : <><Copy className="h-3 w-3" />Copy</>}
        </button>
      </div>
      <pre className="!my-0 !rounded-none !border-0 !bg-transparent !p-3.5 overflow-x-auto text-[12.5px] leading-relaxed font-mono text-slate-100">
        {children}
      </pre>
    </div>
  )
}

/** Sanitised markdown (no raw HTML). Links are restricted to http(s) and open safely. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-chat">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          a: ({ href, children }) => {
            const ok = href && /^https?:\/\//i.test(href)
            return ok ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>
          },
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
