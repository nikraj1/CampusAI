import { fetchEventSource } from '@microsoft/fetch-event-source'
import { getToken } from './api'

export interface Citation {
  id: string
  type: 'document' | 'code'
  documentId?: string
  title?: string
  pageStart?: number
  pageEnd?: number
  snippet?: string
  section?: string
  path?: string
  startLine?: number
  endLine?: number
  repositoryId?: string
}

export interface ChatAction {
  type: 'create_quiz' | 'open_page'
  [k: string]: any
}

export interface StreamHandlers {
  onRun?: (runId: string, agent: string) => void
  onStatus?: (text: string) => void
  onTool?: (line: string) => void
  onToken?: (t: string) => void
  onCitations?: (c: Citation[]) => void
  onAction?: (a: ChatAction) => void
  onDone?: (d: { runId: string; agent: string; grounded: boolean | null }) => void
  onError?: (e: { code: string; message: string; retryable: boolean }) => void
}

/** Parses an SSE event payload; newlines inside data were escaped by the server proxy. */
export function parseData(data: string): any {
  try {
    return JSON.parse(data)
  } catch {
    return {}
  }
}

export async function streamMessage(conversationId: string, content: string, h: StreamHandlers, signal?: AbortSignal) {
  const token = await getToken()
  let finished = false
  await fetchEventSource(`/api/v1/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
    body: JSON.stringify({ content }),
    credentials: 'include',
    signal,
    openWhenHidden: true,
    async onopen(res) {
      if (!res.ok) {
        let msg = res.statusText
        let code = 'ERROR'
        try {
          const j = await res.json()
          msg = j.detail ?? msg
          code = j.code ?? code
        } catch { /* ignore */ }
        h.onError?.({ code, message: msg, retryable: res.status === 429 })
        finished = true
        throw new Error('stream-open-failed')
      }
    },
    onmessage(ev) {
      const d = parseData(ev.data)
      switch (ev.event) {
        case 'run_started': h.onRun?.(d.runId, d.agent); break
        case 'status': h.onStatus?.(d.text); break
        case 'tool_call': h.onTool?.(`Using ${d.tool}${d.args?.query ? `: “${String(d.args.query).slice(0, 60)}”` : d.args?.path ? `: ${d.args.path}` : d.args?.name ? `: ${d.args.name}` : ''}`); break
        case 'tool_result': h.onTool?.(`↳ ${d.summary}`); break
        case 'token': h.onToken?.(d.t); break
        case 'citations': h.onCitations?.(d.citations); break
        case 'action': h.onAction?.(d); break
        case 'done': finished = true; h.onDone?.(d); break
        case 'error': finished = true; h.onError?.(d); break
      }
    },
    onerror(err) {
      if (!finished) h.onError?.({ code: 'NETWORK', message: 'Connection lost while streaming the answer.', retryable: true })
      finished = true
      throw err // stop automatic retries
    },
  }).catch(() => { /* handled above */ })
}
