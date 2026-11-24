import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, FileText, Upload, Trash2, RefreshCw, ListChecks, BarChart3, Library, Plus, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../lib/api'
import { Citation } from '../lib/sse'
import { Badge, Button, Card, Drawer, EmptyState, ErrorBox, Input, Modal, ProgressBar, ScoreGauge, Select, Spinner, cx, fmtBytes, fmtDate, useJob } from '../components/ui'
import { ChatPanel } from '../components/ChatPanel'
import { Markdown } from '../components/Markdown'

const tabs = [
  { to: '/app/study', label: 'Workspace', icon: BookOpen, end: true },
  { to: '/app/study/library', label: 'Library', icon: Library },
  { to: '/app/study/quizzes', label: 'Quizzes', icon: ListChecks },
  { to: '/app/study/progress', label: 'Progress', icon: BarChart3 },
]

export function StudyLayout() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-1 border-b border-slate-200 bg-white px-4">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => cx('flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium', isActive ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800')}>
            <t.icon className="h-4 w-4" />{t.label}
          </NavLink>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <Routes>
          <Route index element={<Workspace />} />
          <Route path="library" element={<LibraryPage />} />
          <Route path="documents/:id" element={<DocumentPage />} />
          <Route path="quizzes" element={<QuizzesPage />} />
          <Route path="quizzes/:id/take" element={<QuizPlayer />} />
          <Route path="attempts/:id" element={<AttemptResult />} />
          <Route path="progress" element={<ProgressPage />} />
        </Routes>
      </div>
    </div>
  )
}

/* ---------------- PDF viewer ---------------- */
export function PdfViewer({ documentId, page, onClose }: { documentId: string | null; page?: number; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const doc = useQuery({ queryKey: ['doc', documentId], enabled: !!documentId, queryFn: () => api.get(`/documents/${documentId}`) })
  useEffect(() => {
    let revoked: string | null = null
    setUrl(null); setErr(null)
    if (documentId) api.blobUrl(`/documents/${documentId}/file`).then((u) => { revoked = u; setUrl(u) }).catch((e) => setErr(e.message))
    return () => { if (revoked) URL.revokeObjectURL(revoked) }
  }, [documentId])
  const isPdf = (doc.data as any)?.mimeType === 'application/pdf'
  return (
    <Drawer open={!!documentId} onClose={onClose} width="max-w-3xl" title={<span>{(doc.data as any)?.title ?? 'Document'}{page ? ` · page ${page}` : ''}</span>}>
      {err && <div className="p-4"><ErrorBox error={err} /></div>}
      {!url && !err && <Spinner />}
      {url && isPdf && <iframe key={`${url}-${page}`} title="PDF viewer" src={`${url}#page=${page ?? 1}`} className="h-full w-full" />}
      {url && doc.data && !isPdf && <div className="p-4 text-sm text-slate-600">Word documents can't be previewed. <a className="text-indigo-600 underline" href={url} download={(doc.data as any).originalFilename}>Download the original</a>. Cited section: {page}.</div>}
    </Drawer>
  )
}

/* ---------------- Workspace ---------------- */
function Workspace() {
  const [sp] = useSearchParams()
  const docs = useQuery({ queryKey: ['documents', 'all'], queryFn: () => api.get('/documents?size=100') })
  const subjects = useQuery({ queryKey: ['subjects'], queryFn: () => api.get('/subjects') })
  const [selected, setSelected] = useState<string[]>([])
  const [subjectId, setSubjectId] = useState('')
  const [view, setView] = useState<{ doc: string; page?: number } | null>(null)
  const items: any[] = (docs.data as any)?.items ?? []
  const ready = items.filter((d) => d.status === 'READY')
  const filtered = subjectId ? ready.filter((d) => d.subjectId === subjectId) : ready
  const scope = useMemo(() => (selected.length ? { documentIds: selected } : subjectId ? { subjectId } : {}), [selected, subjectId])
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const onCitation = (c: Citation) => c.documentId && setView({ doc: c.documentId, page: c.pageStart })
  return (
    <div className="flex h-full">
      <aside className="hidden w-72 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="space-y-2 border-b border-slate-100 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Search scope</div>
          <Select value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setSelected([]) }} aria-label="Subject"><option value="">All subjects</option>{((subjects.data as any[]) ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          <p className="text-xs text-slate-500">{selected.length ? `${selected.length} document(s) selected` : 'Searching all ready documents in this subject'}</p>
        </div>
        <ul className="flex-1 overflow-auto p-2">
          {docs.isLoading && <Spinner />}
          {filtered.map((d) => (
            <li key={d.id}><label className="flex cursor-pointer items-start gap-2 rounded-lg p-2 text-sm hover:bg-slate-50"><input type="checkbox" className="mt-1" checked={selected.includes(d.id)} onChange={() => toggle(d.id)} /><span className="min-w-0"><span className="block truncate font-medium">{d.title}</span><span className="text-xs text-slate-500">{d.pageCount ?? '?'} pages</span></span></label></li>
          ))}
          {!docs.isLoading && filtered.length === 0 && <p className="p-3 text-sm text-slate-500">No ready documents. <Link className="text-indigo-600 underline" to="/app/study/library">Upload some</Link>.</p>}
        </ul>
      </aside>
      <div className="min-w-0 flex-1">
        <ChatPanel key={sp.get('c') ?? 'new'} module="STUDY" scope={scope} conversationId={sp.get('c')} onCitation={onCitation}
          placeholder="Ask a question about your uploaded materials. Answers cite document pages, and I'll tell you when your materials don't cover something."
          suggestions={['Summarize the key points of the selected material', 'Explain the main concept in simple words with an example', 'Quiz me on this material']}
          disabledReason={ready.length === 0 && !docs.isLoading ? 'Upload and process at least one document in the Library first.' : null} />
      </div>
      <PdfViewer documentId={view?.doc ?? null} page={view?.page} onClose={() => setView(null)} />
    </div>
  )
}

/* ---------------- Library ---------------- */
function DocRow({ d }: { d: any }) {
  const qc = useQueryClient()
  const job = useQuery({ queryKey: ['docjob', d.id], enabled: d.status === 'UPLOADED' || d.status === 'PROCESSING', queryFn: () => api.get(`/documents/${d.id}`), refetchInterval: 2000 })
  const lj = (job.data as any)?.latestJob
  const del = useMutation({ mutationFn: () => api.del(`/documents/${d.id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['documents'] }) })
  const re = useMutation({ mutationFn: () => api.post(`/documents/${d.id}/reprocess`), onSuccess: () => qc.invalidateQueries({ queryKey: ['documents'] }) })
  useEffect(() => { if ((job.data as any)?.status && (job.data as any).status !== d.status) qc.invalidateQueries({ queryKey: ['documents'] }) }, [job.data])
  return (
    <tr className="border-t border-slate-100 text-sm">
      <td className="py-3 pr-3"><Link to={`/app/study/documents/${d.id}`} className="flex items-center gap-2 font-medium hover:underline"><FileText className="h-4 w-4 text-indigo-500" />{d.title}</Link>
        {d.status === 'FAILED' && <div className="mt-1 text-xs text-red-600">{d.errorMessage}</div>}
        {(d.status === 'PROCESSING' || d.status === 'UPLOADED') && <div className="mt-1 max-w-xs"><ProgressBar pct={lj?.progress ?? 3} /><div className="mt-0.5 text-xs text-slate-500">{lj?.stage ?? 'Queued'}…</div></div>}
      </td>
      <td className="pr-3"><Badge>{d.status}</Badge></td>
      <td className="pr-3 text-slate-500">{d.pageCount ?? '–'}</td>
      <td className="pr-3 text-slate-500">{d.chunkCount}</td>
      <td className="pr-3 text-slate-500">{fmtBytes(d.sizeBytes)}</td>
      <td className="text-right">
        {(d.status === 'FAILED' || d.status === 'READY') && <button aria-label="Reprocess" title="Reprocess" onClick={() => re.mutate()} className="p-1.5 text-slate-400 hover:text-indigo-600"><RefreshCw className="h-4 w-4" /></button>}
        <button aria-label="Delete document" title="Delete" onClick={() => confirm(`Delete “${d.title}” and its index?`) && del.mutate()} className="p-1.5 text-slate-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
      </td>
    </tr>
  )
}

function LibraryPage() {
  const qc = useQueryClient()
  const [subjectId, setSubjectId] = useState('')
  const [q, setQ] = useState('')
  const [drag, setDrag] = useState(false)
  const [uploadErr, setUploadErr] = useState<string | null>(null)
  const [newSubject, setNewSubject] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const subjects = useQuery({ queryKey: ['subjects'], queryFn: () => api.get('/subjects') })
  const docs = useQuery({
    queryKey: ['documents', subjectId, q], queryFn: () => api.get(`/documents?size=100${subjectId ? `&subjectId=${subjectId}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`),
    refetchInterval: (query) => (((query.state.data as any)?.items ?? []).some((d: any) => d.status === 'UPLOADED' || d.status === 'PROCESSING') ? 3000 : false),
  })
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      for (const f of files) {
        if (!/\.(pdf|docx)$/i.test(f.name)) throw new Error(`${f.name}: only PDF and DOCX are supported`)
        if (f.size > 25 * 1024 * 1024) throw new Error(`${f.name}: exceeds 25 MB`)
        const fd = new FormData(); fd.append('file', f); if (subjectId) fd.append('subjectId', subjectId)
        await api.upload('/documents', fd)
      }
    },
    onSuccess: () => { setUploadErr(null); qc.invalidateQueries({ queryKey: ['documents'] }); qc.invalidateQueries({ queryKey: ['usage'] }) },
    onError: (e: any) => { setUploadErr(e.message); qc.invalidateQueries({ queryKey: ['documents'] }) },
  })
  const addSubject = useMutation({ mutationFn: () => api.post('/subjects', { name: newSubject.trim() }), onSuccess: (s: any) => { setNewSubject(''); setSubjectId(s.id); qc.invalidateQueries({ queryKey: ['subjects'] }) }, onError: (e: any) => setUploadErr(e.message) })
  const items: any[] = (docs.data as any)?.items ?? []
  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-xl font-bold">Document library</h1><p className="text-sm text-slate-500">PDF and DOCX, up to 25 MB each. Text is extracted, chunked and indexed in the background.</p></div>
        <div className="flex items-end gap-2">
          <Select label="Subject" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}><option value="">All / none</option>{((subjects.data as any[]) ?? []).map((s) => <option key={s.id} value={s.id}>{s.name} ({s.documentCount})</option>)}</Select>
          <Input placeholder="New subject" value={newSubject} onChange={(e) => setNewSubject(e.target.value)} aria-label="New subject name" />
          <Button variant="outline" disabled={!newSubject.trim()} loading={addSubject.isPending} onClick={() => addSubject.mutate()}><Plus className="h-4 w-4" /></Button>
        </div>
      </div>
      <div onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); upload.mutate(Array.from(e.dataTransfer.files)) }}
        className={cx('flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition', drag ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 bg-white')}>
        <Upload className="mb-2 h-7 w-7 text-indigo-500" />
        <p className="text-sm text-slate-700">Drag & drop files here, or <button className="font-medium text-indigo-600 underline" onClick={() => fileRef.current?.click()}>browse</button></p>
        <input ref={fileRef} type="file" accept=".pdf,.docx" multiple hidden onChange={(e) => { if (e.target.files) upload.mutate(Array.from(e.target.files)); e.target.value = '' }} />
        {upload.isPending && <div className="mt-3 w-48"><ProgressBar pct={50} /><p className="mt-1 text-xs text-slate-500">Uploading…</p></div>}
      </div>
      {uploadErr && <ErrorBox error={uploadErr} />}
      <Input placeholder="Search documents by title…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search documents" />
      {docs.isLoading ? <Spinner /> : docs.error ? <ErrorBox error={docs.error} retry={() => docs.refetch()} /> : items.length === 0 ? (
        <EmptyState icon={<FileText className="h-8 w-8" />} title="No documents yet" hint="Upload your lecture notes or a textbook chapter to start asking questions and generating quizzes." />
      ) : (
        <Card className="overflow-x-auto"><table className="w-full"><thead className="text-left text-xs uppercase text-slate-500"><tr><th className="pb-2">Title</th><th>Status</th><th>Pages</th><th>Chunks</th><th>Size</th><th /></tr></thead><tbody>{items.map((d) => <DocRow key={d.id} d={d} />)}</tbody></table></Card>
      )}
    </div>
  )
}

/* ---------------- Document detail ---------------- */
function DocumentPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const doc = useQuery({ queryKey: ['doc', id], queryFn: () => api.get(`/documents/${id}`) })
  const [summary, setSummary] = useState<{ title: string; text: string } | null>(null)
  const [view, setView] = useState<number | null>(null)
  const [quizTopic, setQuizTopic] = useState<string | null>(null)
  const sum = useMutation({
    mutationFn: (t: { id?: string; title: string }) => t.id ? api.post(`/study/topics/${t.id}/summary`, { length: 'SHORT' }) : api.post(`/study/documents/${id}/summary`, { length: 'SHORT' }),
    onSuccess: (r: any, t) => { setSummary({ title: t.title, text: r.summary }); qc.invalidateQueries({ queryKey: ['doc', id] }) },
  })
  const quiz = useMutation({
    mutationFn: (topicIds: string[]) => api.post('/quizzes', { title: `Quiz: ${(doc.data as any).title}`.slice(0, 100), documentIds: [id], topicIds, numQuestions: 8, difficulty: 'ADAPTIVE' }),
    onSuccess: () => nav('/app/study/quizzes'),
  })
  if (doc.isLoading) return <Spinner />
  if (doc.error) return <div className="p-6"><ErrorBox error={doc.error} /></div>
  const d = doc.data as any
  return (
    <div className="mx-auto max-w-4xl space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><Link to="/app/study/library" className="text-xs text-indigo-600">← Library</Link><h1 className="text-xl font-bold">{d.title}</h1><div className="mt-1 flex items-center gap-2 text-sm text-slate-500"><Badge>{d.status}</Badge>{d.pageCount} pages · {d.chunkCount} chunks · {fmtBytes(d.sizeBytes)}</div></div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setView(1)}>View document</Button>
          {d.status === 'READY' && <Button variant="outline" loading={sum.isPending && !sum.variables?.id} onClick={() => sum.mutate({ title: 'Document overview' })}>Summarize document</Button>}
          {d.status === 'READY' && <Button loading={quiz.isPending} onClick={() => quiz.mutate([])}>Quiz me</Button>}
        </div>
      </div>
      {sum.error && <ErrorBox error={sum.error} />}{quiz.error && <ErrorBox error={quiz.error} />}
      {d.status === 'FAILED' && <ErrorBox error={d.errorMessage ?? 'Processing failed'} />}
      <Card title="Outline">
        {d.topics.length === 0 ? <p className="text-sm text-slate-500">No outline yet.</p> : (
          <ul className="divide-y divide-slate-100">{d.topics.map((t: any) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" style={{ paddingLeft: (t.level - 1) * 20 }}>
              <button className="text-left font-medium hover:underline" onClick={() => setView(t.pageStart)}>{t.title} <span className="text-xs font-normal text-slate-400">p.{t.pageStart}–{t.pageEnd}</span></button>
              <span className="flex gap-1">
                <Button small variant="ghost" loading={sum.isPending && sum.variables?.id === t.id} onClick={() => sum.mutate({ id: t.id, title: t.title })}>{t.hasSummary ? 'Show summary' : 'Summarize'}</Button>
                <Button small variant="ghost" onClick={() => quiz.mutate([t.id])}>Quiz me</Button>
              </span>
            </li>))}</ul>
        )}
      </Card>
      <Modal open={!!summary} onClose={() => setSummary(null)} title={`Summary: ${summary?.title ?? ''}`} wide>{summary && <Markdown>{summary.text}</Markdown>}</Modal>
      <PdfViewer documentId={view != null ? id! : null} page={view ?? undefined} onClose={() => setView(null)} />
    </div>
  )
}

/* ---------------- Quizzes ---------------- */
function NewQuizModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const docs = useQuery({ queryKey: ['documents', 'all'], queryFn: () => api.get('/documents?size=100'), enabled: open })
  const [sel, setSel] = useState<string[]>([])
  const [topics, setTopics] = useState<string[]>([])
  const [n, setN] = useState(8)
  const [difficulty, setDifficulty] = useState('ADAPTIVE')
  const [types, setTypes] = useState<string[]>(['MCQ_SINGLE'])
  const [title, setTitle] = useState('')
  const ready = (((docs.data as any)?.items ?? []) as any[]).filter((d) => d.status === 'READY')
  const detail = useQuery({ queryKey: ['doc', sel[0]], enabled: sel.length === 1, queryFn: () => api.get(`/documents/${sel[0]}`) })
  const create = useMutation({ mutationFn: () => api.post('/quizzes', { title, documentIds: sel, topicIds: sel.length === 1 ? topics : [], numQuestions: n, difficulty, types }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['quizzes'] }); onClose() } })
  const tgl = (arr: string[], v: string, set: (a: string[]) => void) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])
  return (
    <Modal open={open} onClose={onClose} title="New quiz" wide>
      <div className="space-y-4">
        <Input label="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div><div className="mb-1 text-sm font-medium">Documents</div>
          <div className="max-h-36 space-y-1 overflow-auto rounded-lg border border-slate-200 p-2">{ready.length === 0 ? <p className="text-sm text-slate-500">No ready documents.</p> : ready.map((d) => <label key={d.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sel.includes(d.id)} onChange={() => { tgl(sel, d.id, setSel); setTopics([]) }} />{d.title}</label>)}</div></div>
        {sel.length === 1 && detail.data && (
          <div><div className="mb-1 text-sm font-medium">Topics (optional, leave empty for all chapters)</div>
            <div className="max-h-36 space-y-1 overflow-auto rounded-lg border border-slate-200 p-2">{(detail.data as any).topics.map((t: any) => <label key={t.id} className="flex items-center gap-2 text-sm" style={{ paddingLeft: (t.level - 1) * 16 }}><input type="checkbox" checked={topics.includes(t.id)} onChange={() => tgl(topics, t.id, setTopics)} />{t.title}</label>)}</div></div>)}
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}><option value="ADAPTIVE">Adaptive (by your mastery)</option><option value="EASY">Easy</option><option value="MEDIUM">Medium</option><option value="HARD">Hard</option></Select>
          <Input label="Number of questions (3–25)" type="number" min={3} max={25} value={n} onChange={(e) => setN(Number(e.target.value))} />
        </div>
        <div className="flex gap-4 text-sm">{[['MCQ_SINGLE', 'Single-answer MCQ'], ['MCQ_MULTI', 'Multi-select'], ['TRUE_FALSE', 'True / False']].map(([v, l]) => <label key={v} className="flex items-center gap-2"><input type="checkbox" checked={types.includes(v)} onChange={() => tgl(types, v, setTypes)} />{l}</label>)}</div>
        {create.error && <ErrorBox error={create.error} />}
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={create.isPending} disabled={sel.length === 0 || types.length === 0} onClick={() => create.mutate()}>Generate quiz</Button></div>
      </div>
    </Modal>
  )
}

function QuizRow({ q }: { q: any }) {
  const qc = useQueryClient()
  const nav = useNavigate()
  const del = useMutation({ mutationFn: () => api.del(`/quizzes/${q.id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['quizzes'] }) })
  const start = useMutation({ mutationFn: () => api.post(`/quizzes/${q.id}/attempts`), onSuccess: (a: any) => nav(`/app/study/quizzes/${q.id}/take`, { state: { attemptId: a.attemptId } }) })
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
      <div><div className="font-medium">{q.title}</div><div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500"><Badge>{q.status}</Badge>{q.difficulty} · {q.questionCount} questions · {fmtDate(q.createdAt)}{q.bestScore != null && <span>· best {q.bestScore}/{q.bestMax}</span>}</div>
        {q.status === 'FAILED' && <div className="mt-1 text-xs text-red-600">{q.errorMessage}</div>}</div>
      <div className="flex gap-2">
        {q.status === 'READY' && <Button small loading={start.isPending} onClick={() => start.mutate()}>Take quiz</Button>}
        <Button small variant="ghost" onClick={() => confirm('Delete this quiz?') && del.mutate()} aria-label="Delete quiz"><Trash2 className="h-4 w-4" /></Button>
      </div>
    </li>
  )
}

function QuizzesPage() {
  const [open, setOpen] = useState(false)
  const list = useQuery({ queryKey: ['quizzes'], queryFn: () => api.get('/quizzes'), refetchInterval: (q) => (((q.state.data as any)?.items ?? []).some((x: any) => x.status === 'GENERATING') ? 2500 : false) })
  const items: any[] = (list.data as any)?.items ?? []
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <div className="flex items-center justify-between"><h1 className="text-xl font-bold">Quizzes</h1><Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />New quiz</Button></div>
      {list.isLoading ? <Spinner /> : items.length === 0 ? <EmptyState icon={<ListChecks className="h-8 w-8" />} title="No quizzes yet" hint="Generate a quiz from your documents. Questions are validated, verified against the source, and difficulty adapts to your mastery." action={<Button onClick={() => setOpen(true)}>Create your first quiz</Button>} /> : <Card><ul className="divide-y divide-slate-100">{items.map((q) => <QuizRow key={q.id} q={q} />)}</ul></Card>}
      <NewQuizModal open={open} onClose={() => setOpen(false)} />
    </div>
  )
}

function QuizPlayer() {
  const { id } = useParams()
  const nav = useNavigate()
  const loc = useLocation() as any
  const quiz = useQuery({ queryKey: ['quiz', id], queryFn: () => api.get(`/quizzes/${id}`) })
  const [attemptId, setAttemptId] = useState<string | null>(loc.state?.attemptId ?? null)
  const [i, setI] = useState(0)
  const [answers, setAnswers] = useState<Record<string, number[]>>({})
  const [start] = useState(Date.now())
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t) }, [])
  useEffect(() => { if (!attemptId) api.post(`/quizzes/${id}/attempts`).then((a: any) => setAttemptId(a.attemptId)).catch(() => undefined) }, [attemptId, id])
  const submit = useMutation({ mutationFn: () => api.post(`/quiz-attempts/${attemptId}/submit`, { answers: Object.entries(answers).map(([questionId, selectedIndices]) => ({ questionId, selectedIndices })) }), onSuccess: (r: any) => nav(`/app/study/attempts/${r.attemptId}`, { state: { result: r } }) })
  if (quiz.isLoading) return <Spinner />
  if (quiz.error) return <div className="p-6"><ErrorBox error={quiz.error} /></div>
  const qs: any[] = (quiz.data as any).questions
  const q = qs[i]
  const sel = answers[q.id] ?? []
  const multi = q.type === 'MCQ_MULTI'
  const pick = (idx: number) => setAnswers({ ...answers, [q.id]: multi ? (sel.includes(idx) ? sel.filter((x) => x !== idx) : [...sel, idx]) : [idx] })
  const secs = Math.floor((Date.now() - start) / 1000)
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <div className="flex items-center justify-between text-sm text-slate-500"><span>{(quiz.data as any).title}</span><span className="flex items-center gap-1"><Clock className="h-4 w-4" />{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</span></div>
      <ProgressBar pct={((i + 1) / qs.length) * 100} />
      <Card>
        <div className="mb-1 text-xs font-medium text-slate-500">Question {i + 1} of {qs.length}{q.topicTitle ? ` · ${q.topicTitle}` : ''}{multi ? ' · select all that apply' : ''}</div>
        <h2 className="mb-4 text-base font-semibold">{q.stem}</h2>
        <div role={multi ? 'group' : 'radiogroup'} className="space-y-2">
          {q.options.map((o: string, idx: number) => (
            <button key={idx} role={multi ? 'checkbox' : 'radio'} aria-checked={sel.includes(idx)} onClick={() => pick(idx)} onKeyDown={(e) => { if (e.key >= '1' && e.key <= '4') pick(Number(e.key) - 1) }}
              className={cx('flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition', sel.includes(idx) ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50')}>
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs font-semibold">{String.fromCharCode(65 + idx)}</span>{o}
            </button>
          ))}
        </div>
      </Card>
      {submit.error && <ErrorBox error={submit.error} />}
      <div className="flex justify-between">
        <Button variant="outline" disabled={i === 0} onClick={() => setI(i - 1)}>Previous</Button>
        {i < qs.length - 1 ? <Button onClick={() => setI(i + 1)}>Next</Button> : <Button loading={submit.isPending} disabled={!attemptId} onClick={() => { const un = qs.length - Object.keys(answers).length; if (un === 0 || confirm(`${un} question(s) unanswered. Submit anyway?`)) submit.mutate() }}>Submit</Button>}
      </div>
    </div>
  )
}

function AttemptResult() {
  const { id } = useParams()
  const r = useQuery({ queryKey: ['attempt', id], queryFn: () => api.get(`/quiz-attempts/${id}`) })
  const loc = useLocation() as any
  const [view, setView] = useState<{ doc: string; page: number } | null>(null)
  if (r.isLoading) return <Spinner />
  if (r.error) return <div className="p-6"><ErrorBox error={r.error} /></div>
  const d = r.data as any
  const changes: any[] = loc.state?.result?.masteryChanges ?? []
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <Card><div className="flex items-center gap-6"><ScoreGauge value={Math.round((d.score / d.maxScore) * 100)} label="Score" /><div><div className="text-2xl font-bold">{d.score} / {d.maxScore}</div><div className="text-sm text-slate-500">Completed in {Math.floor(d.durationSeconds / 60)}m {d.durationSeconds % 60}s</div></div></div></Card>
      {changes.length > 0 && <Card title="Mastery changes"><ul className="space-y-1 text-sm">{changes.map((c) => <li key={c.topicId} className="flex justify-between"><span>{c.title}</span><span className={c.after >= c.before ? 'text-emerald-600' : 'text-red-600'}>{Math.round(c.before * 100)}% → {Math.round(c.after * 100)}%</span></li>)}</ul></Card>}
      {d.results.map((x: any, n: number) => (
        <Card key={x.questionId}>
          <div className="mb-2 flex items-start gap-2">{x.correct ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />}<div className="font-medium">{n + 1}. {x.stem}</div></div>
          <ul className="space-y-1 text-sm">{x.options.map((o: string, i: number) => {
            const correct = x.correctIndices.includes(i); const chosen = x.selectedIndices.includes(i)
            return <li key={i} className={cx('rounded px-2 py-1', correct ? 'bg-emerald-50 text-emerald-800' : chosen ? 'bg-red-50 text-red-800' : 'text-slate-600')}>{String.fromCharCode(65 + i)}. {o}{correct ? ' ✓' : ''}{chosen && !correct ? ' (your answer)' : ''}</li>
          })}</ul>
          <p className="mt-2 text-sm text-slate-600"><b>Explanation:</b> {x.explanation}</p>
          {x.sources.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{x.sources.map((s: any, i: number) => <button key={i} className="rounded-md border border-slate-200 px-2 py-1 text-xs text-indigo-700 hover:bg-slate-50 disabled:text-slate-400" disabled={s.title === '(source deleted)'} onClick={() => setView({ doc: s.documentId, page: s.pageStart })}>{s.title} p.{s.pageStart}</button>)}</div>}
        </Card>
      ))}
      <div className="flex gap-2"><Link to="/app/study/quizzes"><Button variant="outline">Back to quizzes</Button></Link><Link to="/app/study/progress"><Button>View progress</Button></Link></div>
      <PdfViewer documentId={view?.doc ?? null} page={view?.page} onClose={() => setView(null)} />
    </div>
  )
}

function ProgressPage() {
  const p = useQuery({ queryKey: ['progress'], queryFn: () => api.get('/study/progress') })
  const t = useQuery({ queryKey: ['progress-topics'], queryFn: () => api.get('/study/progress/topics') })
  if (p.isLoading) return <Spinner />
  const d = p.data as any
  const topics: any[] = (t.data as any[]) ?? []
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <h1 className="text-xl font-bold">Learning progress</h1>
      <div className="grid gap-4 md:grid-cols-3">
        <Card><ScoreGauge value={d.overallMastery != null ? Math.round(d.overallMastery * 100) : null} label="Overall mastery" /></Card>
        <Card title="Activity"><div className="space-y-1 text-sm"><div>Quizzes taken: <b>{d.quizzesTaken}</b></div><div>Current streak: <b>{d.streakDays}</b> day(s)</div></div></Card>
        <Card title="Weakest topics">{d.weakTopics.length === 0 ? <p className="text-sm text-slate-500">Take a quiz to see your weak spots.</p> : <ul className="space-y-1 text-sm">{d.weakTopics.map((w: any) => <li key={w.topicId} className="flex justify-between"><span className="truncate pr-2">{w.title}</span><b>{Math.round(w.mastery * 100)}%</b></li>)}</ul>}</Card>
      </div>
      <Card title="Mastery by topic">
        {topics.length === 0 ? <p className="text-sm text-slate-500">No topics yet.</p> : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{topics.filter((x) => x.level === 1 || x.attempts > 0).map((x) => (
            <div key={x.topicId} className="rounded-lg border border-slate-200 p-3 text-sm" title={`${x.documentTitle}`}>
              <div className="truncate font-medium">{x.title}</div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className={cx('h-full', x.attempts === 0 ? 'bg-slate-300' : x.mastery >= 0.75 ? 'bg-emerald-500' : x.mastery >= 0.4 ? 'bg-amber-500' : 'bg-red-500')} style={{ width: `${Math.round(x.mastery * 100)}%` }} /></div>
              <div className="mt-1 text-xs text-slate-500">{x.attempts === 0 ? 'Not practised yet' : `${Math.round(x.mastery * 100)}% · ${x.attempts} answered`}</div>
            </div>))}</div>)}
      </Card>
      {d.recentAttempts.length > 0 && <Card title="Recent attempts"><div className="h-56"><ResponsiveContainer><BarChart data={[...d.recentAttempts].reverse().map((a: any) => ({ name: a.title.slice(0, 14), pct: Math.round((a.score / a.maxScore) * 100) }))}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis domain={[0, 100]} /><Tooltip /><Bar dataKey="pct" fill="#6366f1" /></BarChart></ResponsiveContainer></div></Card>}
    </div>
  )
}
