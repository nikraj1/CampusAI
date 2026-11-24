import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Bot, FileText, Code2, Send, ThumbsDown, ThumbsUp, Activity, User as UserIcon, Sparkles, AlertTriangle, StopCircle } from 'lucide-react'
import { api } from '../lib/api'
import { streamMessage, Citation, ChatAction } from '../lib/sse'
import { Markdown } from './Markdown'
import { Button, Drawer, Spinner, Accent, accentCls, cx } from './ui'

export interface ChatMsg {
  id: string
  role: 'USER' | 'ASSISTANT'
  content: string
  citations: Citation[]
  agent?: string | null
  runId?: string | null
  status?: string
  grounded?: boolean | null
  actions?: ChatAction[]
  steps?: string[]
  statusLine?: string
  error?: string
  feedback?: number | null
}

interface Props {
  module: 'GENERAL' | 'STUDY' | 'CAREER' | 'PROJECT'
  scope?: Record<string, unknown>
  conversationId?: string | null
  onConversation?: (id: string) => void
  onCitation?: (c: Citation) => void
  accent?: Accent
  placeholder?: string
  suggestions?: string[]
  disabledReason?: string | null
  className?: string
}

export function ChatPanel({ module, scope = {}, conversationId, onConversation, onCitation, accent = 'indigo', placeholder, suggestions = [], disabledReason, className }: Props) {
  const [convId, setConvId] = useState<string | null>(conversationId ?? null)
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [traceRun, setTraceRun] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const nav = useNavigate()
  const qc = useQueryClient()
  const a = accentCls[accent]
  const scopeKey = JSON.stringify(scope)
  const lastScope = useRef(scopeKey)

  useEffect(() => { setConvId(conversationId ?? null) }, [conversationId])

  useEffect(() => {
    if (!convId) { setMessages([]); return }
    if (busy) return
    api.get(`/conversations/${convId}/messages?limit=100`).then((rows: any[]) =>
      setMessages(rows.map((r) => ({ id: r.id, role: r.role, content: r.content, citations: r.citations ?? [], agent: r.agent, runId: r.runId, status: r.status, grounded: r.grounded, feedback: r.feedback }))),
    ).catch(() => setMessages([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convId])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // keep server-side conversation scope in sync with the UI selection
  useEffect(() => {
    if (convId && lastScope.current !== scopeKey) {
      api.patch(`/conversations/${convId}`, { scope }).catch(() => undefined)
    }
    lastScope.current = scopeKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, convId])

  const quiz = useMutation({
    mutationFn: (act: ChatAction) => api.post('/quizzes', { title: act.title, documentIds: act.documentIds, topicIds: act.topicIds, numQuestions: act.numQuestions, difficulty: act.difficulty }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['quizzes'] }); nav('/app/study/quizzes') },
  })

  async function send(text: string) {
    const content = text.trim()
    if (!content || busy) return
    setInput('')
    setBusy(true)
    let id = convId
    const userMsg: ChatMsg = { id: 'u' + Date.now(), role: 'USER', content, citations: [] }
    const asstId = 'a' + Date.now()
    setMessages((m) => [...m, userMsg, { id: asstId, role: 'ASSISTANT', content: '', citations: [], status: 'STREAMING', steps: [], statusLine: 'Thinking…' }])
    const patch = (fn: (m: ChatMsg) => ChatMsg) => setMessages((ms) => ms.map((m) => (m.id === asstId ? fn(m) : m)))
    try {
      if (!id) {
        const c = await api.post('/conversations', { module, scope })
        id = c.id as string
        setConvId(id)
        lastScope.current = scopeKey
        onConversation?.(id)
        qc.invalidateQueries({ queryKey: ['conversations'] })
      }
      const ctrl = new AbortController()
      abortRef.current = ctrl
      await streamMessage(id!, content, {
        onRun: (runId, agent) => patch((m) => ({ ...m, runId, agent })),
        onStatus: (t) => patch((m) => ({ ...m, statusLine: t })),
        onTool: (line) => patch((m) => ({ ...m, steps: [...(m.steps ?? []), line] })),
        onToken: (t) => patch((m) => ({ ...m, content: m.content + t })),
        onCitations: (c) => patch((m) => ({ ...m, citations: c })),
        onAction: (act) => patch((m) => ({ ...m, actions: [...(m.actions ?? []), act] })),
        onDone: (d) => patch((m) => ({ ...m, status: 'COMPLETE', statusLine: undefined, runId: d.runId, agent: d.agent, grounded: d.grounded })),
        onError: (e) => patch((m) => ({ ...m, status: 'ERROR', statusLine: undefined, error: e.message })),
      }, ctrl.signal)
      patch((m) => (m.status === 'STREAMING' ? { ...m, status: 'INCOMPLETE', statusLine: undefined } : m))
      qc.invalidateQueries({ queryKey: ['conversations'] })
      // reload persisted ids so feedback works
      api.get(`/conversations/${id}/messages?limit=100`).then((rows: any[]) => {
        setMessages((cur) => cur.map((m) => {
          const persisted = rows.filter((r) => r.role === m.role)
          return m
        }))
      }).catch(() => undefined)
    } catch (e: any) {
      patch((m) => ({ ...m, status: 'ERROR', statusLine: undefined, error: e?.message ?? 'Failed to send message' }))
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  async function feedback(m: ChatMsg, rating: 1 | -1) {
    if (!convId) return
    const rows: any[] = await api.get(`/conversations/${convId}/messages?limit=100`)
    const idx = messages.filter((x) => x.role === 'ASSISTANT').findIndex((x) => x.id === m.id)
    const target = rows.filter((r) => r.role === 'ASSISTANT')[idx]
    if (!target) return
    await api.post(`/conversations/${convId}/messages/${target.id}/feedback`, { rating })
    setMessages((ms) => ms.map((x) => (x.id === m.id ? { ...x, feedback: rating } : x)))
  }

  return (
    <div className={cx('flex h-full min-h-0 flex-col', className)}>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
        {messages.length === 0 && (
          <div className="mx-auto mt-10 max-w-xl text-center">
            <div className={cx('mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full', a.soft)}><Sparkles className="h-6 w-6" /></div>
            <p className="text-sm text-slate-600">{placeholder ?? 'Ask anything. CampusAI picks the right agent and shows its work.'}</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {suggestions.map((s) => (
                <button key={s} onClick={() => send(s)} disabled={!!disabledReason} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => <Bubble key={m.id} m={m} accent={accent} onCitation={onCitation} onTrace={() => m.runId && setTraceRun(m.runId)} onFeedback={(r) => feedback(m, r)}
          onAction={(act) => (act.type === 'create_quiz' ? quiz.mutate(act) : act.path && nav(act.path))} quizBusy={quiz.isPending} quizError={quiz.error as Error | null} />)}
        <div ref={endRef} />
      </div>
      <form className="border-t border-slate-200 bg-white p-3" onSubmit={(e) => { e.preventDefault(); send(input) }}>
        {disabledReason && <p className="mb-2 flex items-center gap-2 text-xs text-amber-700"><AlertTriangle className="h-3.5 w-3.5" />{disabledReason}</p>}
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) } }}
            rows={1}
            maxLength={8000}
            disabled={!!disabledReason}
            placeholder={disabledReason ? 'Chat unavailable' : 'Type your question… (Enter to send, Shift+Enter for a new line)'}
            aria-label="Message"
            className={cx('max-h-40 min-h-[42px] flex-1 resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2', a.ring)}
          />
          {busy ? (
            <Button type="button" accent={accent} variant="outline" onClick={() => abortRef.current?.abort()} aria-label="Stop"><StopCircle className="h-4 w-4" /></Button>
          ) : (
            <Button type="submit" accent={accent} disabled={!input.trim() || !!disabledReason} aria-label="Send"><Send className="h-4 w-4" /></Button>
          )}
        </div>
      </form>
      <TraceDrawer runId={traceRun} onClose={() => setTraceRun(null)} />
    </div>
  )
}

function Bubble({ m, accent, onCitation, onTrace, onFeedback, onAction, quizBusy, quizError }: {
  m: ChatMsg; accent: Accent; onCitation?: (c: Citation) => void; onTrace: () => void; onFeedback: (r: 1 | -1) => void
  onAction: (a: ChatAction) => void; quizBusy: boolean; quizError: Error | null
}) {
  const a = accentCls[accent]
  if (m.role === 'USER') {
    return (
      <div className="flex justify-end gap-2">
        <div className={cx('max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-tr-sm px-4 py-2 text-sm text-white', a.bg.split(' ')[0])}>{m.content}</div>
        <UserIcon className="mt-1 h-5 w-5 shrink-0 text-slate-400" />
      </div>
    )
  }
  return (
    <div className="flex gap-2">
      <Bot className={cx('mt-1 h-5 w-5 shrink-0', a.text)} />
      <div className="max-w-[88%] min-w-0 flex-1">
        {m.agent && <span className={cx('mb-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium', a.soft)}>{m.agent} agent</span>}
        {(m.steps?.length ?? 0) > 0 && (
          <details className="mb-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600" open={m.status === 'STREAMING'}>
            <summary className="cursor-pointer select-none font-medium">Agent activity ({m.steps!.length})</summary>
            <ul className="mt-1 space-y-0.5">{m.steps!.map((s, i) => <li key={i} className="font-mono">{s}</li>)}</ul>
          </details>
        )}
        {m.status === 'STREAMING' && !m.content && <div className="flex items-center gap-2 text-sm text-slate-500"><Spinner label={m.statusLine ?? 'Thinking…'} /></div>}
        {m.status === 'STREAMING' && m.content && m.statusLine && <div className="mb-1 text-xs text-slate-400">{m.statusLine}</div>}
        {m.content && <div className="rounded-2xl rounded-tl-sm border border-slate-200 bg-white px-4 py-2"><Markdown>{m.content}</Markdown></div>}
        {m.error && <div className="mt-2 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{m.error}</div>}
        {m.status === 'INCOMPLETE' && <div className="mt-1 text-xs text-amber-600">Response was interrupted.</div>}
        {m.citations.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {m.citations.map((c) => (
              <button key={c.id} onClick={() => onCitation?.(c)} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50" title={c.snippet ?? c.path}>
                {c.type === 'document' ? <FileText className="h-3 w-3" /> : <Code2 className="h-3 w-3" />}
                <span className="font-semibold">{c.id}</span>
                <span className="max-w-[200px] truncate">{c.type === 'document' ? `${c.title} p.${c.pageStart}${c.pageEnd !== c.pageStart ? `–${c.pageEnd}` : ''}` : `${c.path}:${c.startLine}-${c.endLine}`}</span>
              </button>
            ))}
          </div>
        )}
        {m.grounded === false && m.agent === 'study' && m.status === 'COMPLETE' && (
          <div className="mt-1 text-xs text-amber-700">Some statements may not be supported by your documents.</div>
        )}
        {(m.actions ?? []).map((act, i) => (
          <div key={i} className="mt-2">
            <Button accent={accent} small loading={quizBusy} onClick={() => onAction(act)}>{act.type === 'create_quiz' ? 'Generate quiz' : act.label}</Button>
            {quizError && <span className="ml-2 text-xs text-red-600">{quizError.message}</span>}
          </div>
        ))}
        {m.status === 'COMPLETE' && (
          <div className="mt-1 flex items-center gap-1 text-slate-400">
            <button onClick={() => onFeedback(1)} aria-label="Good answer" className={cx('rounded p-1 hover:bg-slate-100', m.feedback === 1 && 'text-emerald-600')}><ThumbsUp className="h-3.5 w-3.5" /></button>
            <button onClick={() => onFeedback(-1)} aria-label="Bad answer" className={cx('rounded p-1 hover:bg-slate-100', m.feedback === -1 && 'text-red-600')}><ThumbsDown className="h-3.5 w-3.5" /></button>
            {m.runId && <button onClick={onTrace} className="ml-1 flex items-center gap-1 rounded px-1.5 py-1 text-xs hover:bg-slate-100"><Activity className="h-3.5 w-3.5" />Agent trace</button>}
          </div>
        )}
      </div>
    </div>
  )
}

function TraceDrawer({ runId, onClose }: { runId: string | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ['run', runId], enabled: !!runId, queryFn: () => api.get(`/agent-runs/${runId}`) })
  return (
    <Drawer open={!!runId} onClose={onClose} title="Agent trace">
      {q.isLoading && <Spinner />}
      {q.data && (
        <div className="space-y-3 p-4 text-sm">
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
            <div>Route: <b>{q.data.route}</b></div><div>Status: <b>{q.data.status}</b></div>
            <div>Latency: <b>{q.data.latencyMs} ms</b></div><div>Tokens: <b>{q.data.tokensIn + q.data.tokensOut}</b></div>
          </div>
          <ol className="space-y-2">
            {q.data.steps.map((s: any) => (
              <li key={s.stepIndex} className="rounded-lg border border-slate-200 p-2.5">
                <div className="flex items-center justify-between text-xs"><span className="font-semibold">{s.stepIndex}. {s.node}</span><span className="rounded bg-slate-100 px-1.5 py-0.5">{s.type}</span></div>
                <div className="mt-1 text-[11px] text-slate-500">{s.providerModel ? `${s.providerModel} · ` : ''}{s.latencyMs != null ? `${s.latencyMs} ms` : ''}{s.tokensIn ? ` · ${s.tokensIn}→${s.tokensOut} tok` : ''}{s.status !== 'OK' ? ` · ${s.status}` : ''}</div>
                {s.outputPreview && <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-[11px]">{typeof s.outputPreview === 'string' ? s.outputPreview : JSON.stringify(s.outputPreview, null, 1)}</pre>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </Drawer>
  )
}
