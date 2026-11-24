import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'

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
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
