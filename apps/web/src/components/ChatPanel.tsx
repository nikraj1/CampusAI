import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Bot, FileText, Code2, Send, ThumbsDown, ThumbsUp, Activity, User as UserIcon,
  Sparkles, AlertTriangle, StopCircle, ArrowUpRight, Copy, Check, Cpu, Clock, Layers,
} from 'lucide-react'
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

const moduleTitles: Record<Props['module'], string> = {
  GENERAL: 'Ask CampusAI anything',
  STUDY: 'Study AI Tutor',
  CAREER: 'Career AI Coach',
  PROJECT: 'Project AI Engineer',
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
      api.get(`/conversations/${id}/messages?limit=100`).then((rows: any[]) => {
        setMessages((cur) => cur.map((m) => {
          void rows.filter((r) => r.role === m.role)
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
    <div className={cx('flex h-full min-h-0 flex-col bg-slate-50/70', className)}>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6" aria-live="polite">
        <div className="mx-auto max-w-3xl space-y-5">
          {messages.length === 0 && (
            <div className="animate-fade-in mx-auto mt-8 max-w-2xl text-center">
              <div className={cx('mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl shadow-sm ring-1 ring-inset ring-black/5', a.soft)}>
                <Sparkles className="h-7 w-7" />
              </div>
              <h2 className="text-xl font-bold tracking-tight text-slate-900">{moduleTitles[module]}</h2>
              <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-slate-500">
                {placeholder ?? 'Ask anything. CampusAI picks the right agent and shows its work.'}
              </p>
              {suggestions.length > 0 && (
                <div className="mt-6 grid gap-2.5 text-left sm:grid-cols-2">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      disabled={!!disabledReason}
                      className="group flex items-start justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-3.5 text-left text-xs font-medium leading-relaxed text-slate-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow disabled:pointer-events-none disabled:opacity-50"
                    >
                      <span>{s}</span>
                      <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-indigo-500" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {messages.map((m) => (
            <Bubble
              key={m.id}
              m={m}
              accent={accent}
              onCitation={onCitation}
              onTrace={() => m.runId && setTraceRun(m.runId)}
              onFeedback={(r) => feedback(m, r)}
              onAction={(act) => (act.type === 'create_quiz' ? quiz.mutate(act) : act.path && nav(act.path))}
              quizBusy={quiz.isPending}
              quizError={quiz.error as Error | null}
            />
          ))}
          <div ref={endRef} />
        </div>
      </div>

      <div className="border-t border-slate-200/80 bg-white/90 px-4 py-3 backdrop-blur-md">
        <form className="mx-auto max-w-3xl" onSubmit={(e) => { e.preventDefault(); send(input) }}>
          {disabledReason && (
            <p className="mb-2 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {disabledReason}
            </p>
          )}
          <div className={cx('flex items-end gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm transition-all focus-within:border-indigo-400 focus-within:ring-2', a.ring.replace('focus:', 'focus-within:'))}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) } }}
              rows={1}
              maxLength={8000}
              disabled={!!disabledReason}
              placeholder={disabledReason ? 'Chat unavailable' : 'Ask a follow-up or new question…'}
              aria-label="Message"
              className="max-h-40 min-h-[38px] flex-1 resize-none border-0 bg-transparent px-2.5 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-0"
            />
            {busy ? (
              <Button type="button" accent={accent} variant="outline" onClick={() => abortRef.current?.abort()} aria-label="Stop" className="h-9 w-9 !rounded-xl !p-0">
                <StopCircle className="h-4 w-4 text-red-500" />
              </Button>
            ) : (
              <Button type="submit" accent={accent} disabled={!input.trim() || !!disabledReason} aria-label="Send" className="h-9 w-9 !rounded-xl !p-0">
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
          <div className="mt-1.5 flex items-center justify-between px-1 text-[11px] text-slate-400">
            <span>Enter to send · Shift+Enter for new line</span>
            <span>Grounded &amp; traced agent responses</span>
          </div>
        </form>
      </div>
      <TraceDrawer runId={traceRun} onClose={() => setTraceRun(null)} />
    </div>
  )
}

function Bubble({ m, accent, onCitation, onTrace, onFeedback, onAction, quizBusy, quizError }: {
  m: ChatMsg; accent: Accent; onCitation?: (c: Citation) => void; onTrace: () => void; onFeedback: (r: 1 | -1) => void
  onAction: (a: ChatAction) => void; quizBusy: boolean; quizError: Error | null
}) {
  const a = accentCls[accent]
  const [copied, setCopied] = useState(false)

  if (m.role === 'USER') {
    return (
      <div className="animate-fade-in flex items-start justify-end gap-2.5">
        <div className={cx('max-w-[82%] whitespace-pre-wrap rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed text-white shadow-sm', a.bg.split(' ')[0])}>
          {m.content}
        </div>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-200 text-slate-600">
          <UserIcon className="h-4 w-4" />
        </div>
      </div>
    )
  }

  function copyReply() {
    navigator.clipboard?.writeText(m.content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    }).catch(() => undefined)
  }

  return (
    <div className="animate-fade-in flex items-start gap-2.5">
      <div className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-xl shadow-sm', a.soft)}>
        <Bot className="h-4 w-4" />
      </div>
      <div className="min-w-0 max-w-[90%] flex-1">
        <div className="mb-1.5 flex items-center gap-2">
          {m.agent && (
            <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize', a.soft)}>
              <Sparkles className="h-2.5 w-2.5" />
              {m.agent} agent
            </span>
          )}
          {m.status === 'STREAMING' && m.statusLine && (
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-pulse-dot" />
              {m.statusLine}
            </span>
          )}
        </div>

        {(m.steps?.length ?? 0) > 0 && (
          <details className="mb-2.5 rounded-xl border border-slate-200/80 bg-white px-3.5 py-2 text-xs text-slate-600 shadow-sm" open={m.status === 'STREAMING'}>
            <summary className="cursor-pointer select-none font-medium text-slate-700">
              Agent activity ({m.steps!.length} step{m.steps!.length > 1 ? 's' : ''})
            </summary>
            <ul className="mt-2 space-y-1 border-l-2 border-slate-200 pl-3">
              {m.steps!.map((s, i) => (
                <li key={i} className="font-mono text-[11px] text-slate-500">{s}</li>
              ))}
            </ul>
          </details>
        )}

        {m.status === 'STREAMING' && !m.content && (
          <div className="inline-flex items-center gap-2 rounded-2xl rounded-tl-sm border border-slate-200/80 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
            <span className="flex gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: '300ms' }} />
            </span>
            <span className="text-xs font-medium">{m.statusLine ?? 'Thinking…'}</span>
          </div>
        )}

        {m.content && (
          <div className="rounded-2xl rounded-tl-sm border border-slate-200/80 bg-white px-4 py-3 shadow-sm">
            <Markdown>{m.content}</Markdown>
          </div>
        )}

        {m.error && (
          <div className="mt-2 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{m.error}</span>
          </div>
        )}

        {m.status === 'INCOMPLETE' && <div className="mt-1.5 text-xs font-medium text-amber-600">Response was interrupted.</div>}

        {m.citations.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {m.citations.map((c) => (
              <button
                key={c.id}
                onClick={() => onCitation?.(c)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-300 hover:bg-indigo-50/40"
                title={c.snippet ?? c.path}
              >
                {c.type === 'document' ? <FileText className="h-3.5 w-3.5 text-indigo-500" /> : <Code2 className="h-3.5 w-3.5 text-amber-500" />}
                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-700">{c.id}</span>
                <span className="max-w-[210px] truncate font-medium">
                  {c.type === 'document' ? `${c.title} · p.${c.pageStart}${c.pageEnd !== c.pageStart ? `–${c.pageEnd}` : ''}` : `${c.path}:${c.startLine}-${c.endLine}`}
                </span>
              </button>
            ))}
          </div>
        )}

        {m.grounded === false && m.agent === 'study' && m.status === 'COMPLETE' && (
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
            <AlertTriangle className="h-3.5 w-3.5" />
            Some statements may not be supported by your documents.
          </div>
        )}

        {(m.actions ?? []).map((act, i) => (
          <div key={i} className="mt-2.5 flex items-center gap-2">
            <Button accent={accent} small loading={quizBusy} onClick={() => onAction(act)}>
              {act.type === 'create_quiz' ? 'Generate quiz' : act.label}
            </Button>
            {quizError && <span className="text-xs text-red-600">{quizError.message}</span>}
          </div>
        ))}

        {m.status === 'COMPLETE' && (
          <div className="mt-1.5 flex items-center gap-1 text-slate-400">
            <button onClick={copyReply} aria-label="Copy response" title="Copy response" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition hover:bg-slate-100 hover:text-slate-700">
              {copied ? <><Check className="h-3.5 w-3.5 text-emerald-500" />Copied</> : <><Copy className="h-3.5 w-3.5" />Copy</>}
            </button>
            <button onClick={() => onFeedback(1)} aria-label="Good answer" className={cx('rounded-lg p-1.5 transition hover:bg-slate-100', m.feedback === 1 && 'text-emerald-600')}>
              <ThumbsUp className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => onFeedback(-1)} aria-label="Bad answer" className={cx('rounded-lg p-1.5 transition hover:bg-slate-100', m.feedback === -1 && 'text-red-600')}>
              <ThumbsDown className="h-3.5 w-3.5" />
            </button>
            {m.runId && (
              <button onClick={onTrace} className="ml-1 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition hover:bg-slate-100 hover:text-slate-700">
                <Activity className="h-3.5 w-3.5 text-indigo-500" />
                Agent trace
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function TraceDrawer({ runId, onClose }: { runId: string | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ['run', runId], enabled: !!runId, queryFn: () => api.get(`/agent-runs/${runId}`) })
  return (
    <Drawer open={!!runId} onClose={onClose} title={<span className="flex items-center gap-2"><Activity className="h-4 w-4 text-indigo-500" />Agent execution trace</span>}>
      {q.isLoading && <Spinner label="Loading trace…" />}
      {q.data && (
        <div className="space-y-4 p-5 text-sm">
          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500"><Layers className="h-3.5 w-3.5" />Route</div>
              <div className="mt-1 font-semibold text-slate-900">{q.data.route}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-[11px] font-medium text-slate-500">Status</div>
              <div className="mt-1 font-semibold text-emerald-700">{q.data.status}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500"><Clock className="h-3.5 w-3.5" />Latency</div>
              <div className="mt-1 font-semibold text-slate-900">{q.data.latencyMs} ms</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500"><Cpu className="h-3.5 w-3.5" />Tokens</div>
              <div className="mt-1 font-semibold text-slate-900">{(q.data.tokensIn + q.data.tokensOut).toLocaleString()}</div>
            </div>
          </div>

          <ol className="relative space-y-3 border-l-2 border-slate-200 pl-4">
            {q.data.steps.map((s: any) => (
              <li key={s.stepIndex} className="relative rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <span className="absolute -left-[23px] top-4 h-2.5 w-2.5 rounded-full border-2 border-white bg-indigo-500" />
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-slate-900">{s.stepIndex}. {s.node}</span>
                  <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-indigo-700">{s.type}</span>
                </div>
                <div className="mt-1 font-mono text-[11px] text-slate-500">
                  {s.providerModel ? `${s.providerModel} · ` : ''}
                  {s.latencyMs != null ? `${s.latencyMs} ms` : ''}
                  {s.tokensIn ? ` · ${s.tokensIn}→${s.tokensOut} tok` : ''}
                  {s.status !== 'OK' ? ` · ${s.status}` : ''}
                </div>
                {s.outputPreview && (
                  <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-2.5 font-mono text-[11px] text-slate-700">
                    {typeof s.outputPreview === 'string' ? s.outputPreview : JSON.stringify(s.outputPreview, null, 2)}
                  </pre>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </Drawer>
  )
}
