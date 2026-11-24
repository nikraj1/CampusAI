import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Briefcase, FileText, ListTodo, MessageCircle, Mic, Plus, Star, Trash2, Upload, CheckCircle2, XCircle, Map as MapIcon, Target } from 'lucide-react'
import { PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer } from 'recharts'
import { api } from '../lib/api'
import { Citation } from '../lib/sse'
import { Badge, Button, Card, EmptyState, ErrorBox, Input, ProgressBar, ScoreGauge, Select, Spinner, cx, fmtDate, useJob } from '../components/ui'
import { ChatPanel } from '../components/ChatPanel'
import { PdfViewer } from './study'

const tabs = [
  { to: '/app/career', label: 'Overview', icon: Briefcase, end: true },
  { to: '/app/career/resumes', label: 'Resumes', icon: FileText },
  { to: '/app/career/jobs', label: 'Jobs', icon: Target },
  { to: '/app/career/roadmaps', label: 'Roadmaps', icon: MapIcon },
  { to: '/app/career/interviews', label: 'Interviews', icon: Mic },
]

export function CareerLayout() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-4">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => cx('flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium', isActive ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-slate-500 hover:text-slate-800')}><t.icon className="h-4 w-4" />{t.label}</NavLink>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <Routes>
          <Route index element={<Overview />} />
          <Route path="resumes" element={<ResumesPage />} />
          <Route path="resumes/:id" element={<ResumeDetail />} />
          <Route path="jobs" element={<JobsPage />} />
          <Route path="analyses/:id" element={<AnalysisPage />} />
          <Route path="roadmaps" element={<RoadmapsPage />} />
          <Route path="roadmaps/:id" element={<RoadmapPage />} />
          <Route path="interviews" element={<InterviewsPage />} />
          <Route path="interviews/:id" element={<InterviewSession />} />
        </Routes>
      </div>
    </div>
  )
}

function Overview() {
  const [sp] = useSearchParams()
  const analyses = useQuery({ queryKey: ['analyses'], queryFn: () => api.get('/career/analyses') })
  const resumes = useQuery({ queryKey: ['resumes'], queryFn: () => api.get('/career/resumes') })
  const skills = useQuery({ queryKey: ['skills-me'], queryFn: () => api.get('/career/skills/me') })
  const [view, setView] = useState<{ doc: string; page?: number } | null>(null)
  const latest = (analyses.data as any[] | undefined)?.[0]
  const detail = useQuery({ queryKey: ['analysis', latest?.id], enabled: !!latest, queryFn: () => api.get(`/career/analyses/${latest.id}`) })
  const radar = detail.data ? Object.entries((detail.data as any).result.sectionScores ?? {}).map(([k, v]) => ({ k, v })) : []
  return (
    <div className="flex h-full flex-col lg:flex-row">
      <div className="space-y-4 overflow-auto p-4 lg:w-[420px] lg:shrink-0 lg:border-r lg:border-slate-200">
        <Card title="Latest resume analysis" action={latest && <Link to={`/app/career/analyses/${latest.id}`} className="text-xs text-emerald-600">Open</Link>}>
          {analyses.isLoading ? <Spinner /> : !latest ? (
            <EmptyState title="No analysis yet" hint={(resumes.data as any[] | undefined)?.length ? 'Open a resume and click Analyze.' : 'Upload your resume to get an explainable score.'} action={<Link to="/app/career/resumes"><Button accent="emerald">Go to resumes</Button></Link>} />
          ) : (
            <div className="space-y-3"><div className="flex justify-around"><ScoreGauge value={latest.overallScore} label="Resume score" />{latest.matchScore != null && <ScoreGauge value={latest.matchScore} label={`Match: ${latest.jobTitle ?? 'job'}`} />}</div>
              {radar.length > 0 && <div className="h-48"><ResponsiveContainer><RadarChart data={radar}><PolarGrid /><PolarAngleAxis dataKey="k" tick={{ fontSize: 10 }} /><Radar dataKey="v" stroke="#059669" fill="#10b981" fillOpacity={0.4} /></RadarChart></ResponsiveContainer></div>}</div>
          )}
        </Card>
        <Card title="Your skills">{(skills.data as any[] | undefined)?.length ? <div className="flex flex-wrap gap-1.5">{(skills.data as any[]).map((s) => <span key={s.skill} className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">{s.skill}</span>)}</div> : <p className="text-sm text-slate-500">Skills are extracted from your resume.</p>}</Card>
      </div>
      <div className="min-h-[420px] min-w-0 flex-1">
        <ChatPanel key={sp.get('c') ?? 'new'} module="CAREER" accent="emerald" conversationId={sp.get('c')} onCitation={(c: Citation) => c.documentId && setView({ doc: c.documentId, page: c.pageStart })}
          placeholder="Ask about your resume, job fit, skill gaps or interview prep. The Career agent reads your resume, job descriptions and study notes with tools."
          suggestions={['Am I ready for my latest saved job description?', 'What are my biggest skill gaps and where in my notes can I study them?', 'How can I improve my resume bullets?']} />
      </div>
      <PdfViewer documentId={view?.doc ?? null} page={view?.page} onClose={() => setView(null)} />
    </div>
  )
}

/* ---------------- resumes ---------------- */
function ResumesPage() {
  const qc = useQueryClient()
  const nav = useNavigate()
  const ref = useRef<HTMLInputElement>(null)
  const [err, setErr] = useState<string | null>(null)
  const list = useQuery({ queryKey: ['resumes'], queryFn: () => api.get('/career/resumes'), refetchInterval: (q) => (((q.state.data as any[]) ?? []).some((r) => r.parseStatus === 'PENDING') ? 2500 : false) })
  const up = useMutation({
    mutationFn: (f: File) => { if (!/\.(pdf|docx)$/i.test(f.name)) throw new Error('Only PDF or DOCX resumes are supported'); if (f.size > 5 * 1024 * 1024) throw new Error('Resume must be under 5 MB'); const fd = new FormData(); fd.append('file', f); return api.upload('/career/resumes', fd) },
    onSuccess: () => { setErr(null); qc.invalidateQueries({ queryKey: ['resumes'] }) }, onError: (e: any) => setErr(e.message),
  })
  const items: any[] = (list.data as any[]) ?? []
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <div className="flex items-center justify-between"><div><h1 className="text-xl font-bold">Resumes</h1><p className="text-sm text-slate-500">PDF or DOCX up to 5 MB. Contact details are masked before any text reaches an AI model.</p></div>
        <Button accent="emerald" loading={up.isPending} onClick={() => ref.current?.click()}><Upload className="h-4 w-4" />Upload resume</Button><input ref={ref} type="file" hidden accept=".pdf,.docx" onChange={(e) => { const f = e.target.files?.[0]; if (f) up.mutate(f); e.target.value = '' }} /></div>
      {err && <ErrorBox error={err} />}
      {list.isLoading ? <Spinner /> : items.length === 0 ? <EmptyState icon={<FileText className="h-8 w-8" />} title="No resumes yet" hint="Upload your resume to see its structure, skills and an explainable score." /> : (
        <Card><ul className="divide-y divide-slate-100">{items.map((r) => (
          <li key={r.id} className="flex items-center justify-between py-3 text-sm"><button className="flex items-center gap-2 font-medium hover:underline" onClick={() => nav(`/app/career/resumes/${r.id}`)}><FileText className="h-4 w-4 text-emerald-600" />{r.label}{r.isPrimary && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-label="Primary" />}</button><span className="flex items-center gap-3"><Badge>{r.parseStatus}</Badge><span className="text-xs text-slate-400">{fmtDate(r.createdAt)}</span></span></li>))}</ul></Card>)}
    </div>
  )
}

function ResumeDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const r = useQuery({ queryKey: ['resume', id], queryFn: () => api.get(`/career/resumes/${id}`), refetchInterval: (q) => ((q.state.data as any)?.parseStatus === 'PENDING' ? 2000 : false) })
  const jds = useQuery({ queryKey: ['jds'], queryFn: () => api.get('/career/job-descriptions') })
  const analyses = useQuery({ queryKey: ['analyses', id], queryFn: () => api.get(`/career/analyses?resumeId=${id}`) })
  const [jd, setJd] = useState('')
  const [jobId, setJobId] = useState<string | null>(null)
  const job = useJob(jobId)
  const analyze = useMutation({ mutationFn: () => api.post('/career/analyses', { resumeId: id, jobDescriptionId: jd || undefined }), onSuccess: (x: any) => setJobId(x.jobId) })
  const primary = useMutation({ mutationFn: () => api.patch(`/career/resumes/${id}`, { isPrimary: true }), onSuccess: () => qc.invalidateQueries({ queryKey: ['resume', id] }) })
  const del = useMutation({ mutationFn: () => api.del(`/career/resumes/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['resumes'] }); nav('/app/career/resumes') } })
  const [skillEdit, setSkillEdit] = useState('')
  const saveSkills = useMutation({ mutationFn: (skills: any[]) => api.patch(`/career/resumes/${id}`, { parsedSkills: skills }), onSuccess: () => qc.invalidateQueries({ queryKey: ['resume', id] }) })
  const j = job.data as any
  useEffect(() => { if (j?.status === 'SUCCEEDED') { qc.invalidateQueries({ queryKey: ['analyses'] }); nav(`/app/career/analyses/${j.result.analysisId}`) } }, [j?.status])
  if (r.isLoading) return <Spinner />
  if (r.error) return <div className="p-6"><ErrorBox error={r.error} /></div>
  const d = r.data as any
  const p = d.parsed
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><Link to="/app/career/resumes" className="text-xs text-emerald-600">← Resumes</Link><h1 className="text-xl font-bold">{d.label}</h1><div className="mt-1 flex gap-2"><Badge>{d.parseStatus}</Badge>{d.isPrimary && <Badge tone="bg-amber-50 text-amber-700">Primary</Badge>}{p && !p.llm && <Badge tone="bg-slate-100 text-slate-600">basic parse (no LLM)</Badge>}</div></div>
        <div className="flex gap-2">{!d.isPrimary && <Button variant="outline" onClick={() => primary.mutate()}>Make primary</Button>}<Button variant="ghost" onClick={() => confirm('Delete this resume and its analyses?') && del.mutate()} aria-label="Delete"><Trash2 className="h-4 w-4" /></Button></div>
      </div>
      {d.parseStatus === 'PENDING' && <Card><ProgressBar pct={d.latestJob?.progress ?? 5} /><p className="mt-2 text-sm text-slate-500">Parsing… {d.latestJob?.stage}</p></Card>}
      {d.parseStatus === 'FAILED' && <ErrorBox error={d.latestJob?.errorMessage ?? 'Parsing failed. Try a text-based PDF or DOCX.'} />}
      {p && (<>
        <Card title="Analyze" action={<span className="text-xs text-slate-500">Scores use transparent rules; AI writes the suggestions.</span>}>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[220px] flex-1"><Select label="Match against a job description (optional)" value={jd} onChange={(e) => setJd(e.target.value)}><option value="">General resume review</option>{((jds.data as any[]) ?? []).map((x) => <option key={x.id} value={x.id}>{x.title ?? 'Untitled'}{x.company ? ` — ${x.company}` : ''}</option>)}</Select></div>
            <Button accent="emerald" loading={analyze.isPending || (!!jobId && j?.status !== 'FAILED' && j?.status !== 'SUCCEEDED')} onClick={() => analyze.mutate()}>Analyze</Button>
          </div>
          {jobId && j?.status === 'RUNNING' && <p className="mt-2 text-xs text-slate-500">Analysing…</p>}
          {j?.status === 'FAILED' && <div className="mt-3"><ErrorBox error={j.errorMessage} /></div>}
          {analyze.error && <div className="mt-3"><ErrorBox error={analyze.error} /></div>}
          {((analyses.data as any[]) ?? []).length > 0 && <div className="mt-4 text-sm"><div className="mb-1 font-medium">Previous analyses</div><ul className="space-y-1">{(analyses.data as any[]).slice(0, 5).map((a) => <li key={a.id}><Link className="text-emerald-700 hover:underline" to={`/app/career/analyses/${a.id}`}>{a.type === 'JD_MATCH' ? `Match: ${a.jobTitle ?? 'job'} (${a.matchScore})` : 'General review'} · score {a.overallScore}</Link> <span className="text-xs text-slate-400">{fmtDate(a.createdAt)}</span></li>)}</ul></div>}
        </Card>
        <Card title={`Skills (${p.skills.length})`} action={<span className="text-xs text-slate-500">Click × to remove a wrong skill</span>}>
          <div className="flex flex-wrap gap-1.5">{p.skills.map((s: any) => <span key={s.name} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">{s.name}<button aria-label={`Remove ${s.name}`} className="hover:text-red-600" onClick={() => saveSkills.mutate(p.skills.filter((x: any) => x.name !== s.name))}>×</button></span>)}</div>
          <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (skillEdit.trim()) { saveSkills.mutate([...p.skills, { name: skillEdit.trim() }]); setSkillEdit('') } }}><Input placeholder="Add a skill" value={skillEdit} onChange={(e) => setSkillEdit(e.target.value)} aria-label="Add skill" /><Button variant="outline" type="submit">Add</Button></form>
        </Card>
        {p.education?.length > 0 && <Card title="Education"><ul className="space-y-1 text-sm">{p.education.map((e: any, i: number) => <li key={i}><b>{e.degree}</b> {e.field} — {e.institution} {e.year && `(${e.year})`} {e.score && `· ${e.score}`}</li>)}</ul></Card>}
        {p.experience?.length > 0 && <Card title="Experience"><ul className="space-y-2 text-sm">{p.experience.map((e: any, i: number) => <li key={i}><b>{e.role}</b> @ {e.company} <span className="text-slate-400">{e.duration}</span><ul className="ml-4 list-disc text-slate-600">{e.bullets.slice(0, 4).map((b: string, k: number) => <li key={k}>{b}</li>)}</ul></li>)}</ul></Card>}
        {p.projects?.length > 0 && <Card title="Projects"><ul className="space-y-2 text-sm">{p.projects.map((e: any, i: number) => <li key={i}><b>{e.name}</b> <span className="text-slate-500">{e.tech?.join(', ')}</span><div className="text-slate-600">{e.description}</div></li>)}</ul></Card>}
      </>)}
    </div>
  )
}

function AnalysisPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const a = useQuery({ queryKey: ['analysis', id], queryFn: () => api.get(`/career/analyses/${id}`) })
  const [weeks, setWeeks] = useState(8)
  const [hours, setHours] = useState(10)
  const [role, setRole] = useState('')
  const [jobId, setJobId] = useState<string | null>(null)
  const job = useJob(jobId)
  const make = useMutation({ mutationFn: () => api.post('/career/roadmaps', { targetRole: role || (a.data as any).jobTitle || 'Software Engineer', analysisId: id, durationWeeks: weeks, hoursPerWeek: hours }), onSuccess: (x: any) => setJobId(x.jobId) })
  const j = job.data as any
  useEffect(() => { if (j?.status === 'SUCCEEDED') nav(`/app/career/roadmaps/${j.result.roadmapId}`) }, [j?.status])
  if (a.isLoading) return <Spinner />
  if (a.error) return <div className="p-6"><ErrorBox error={a.error} /></div>
  const d = a.data as any
  const r = d.result
  const sec = Object.entries(r.sectionScores ?? {}) as [string, number][]
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <Link to={`/app/career/resumes/${d.resumeId}`} className="text-xs text-emerald-600">← Resume</Link>
      <h1 className="text-xl font-bold">{d.type === 'JD_MATCH' ? `Match report: ${d.jobTitle ?? 'Job'}${d.company ? ` @ ${d.company}` : ''}` : 'Resume review'}</h1>
      {!r.llm && <div className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">AI-written suggestions were unavailable ({r.llmError ?? 'no LLM'}); scores and rule-based tips are shown.</div>}
      <div className="grid gap-4 md:grid-cols-3">
        <Card><div className="flex justify-around"><ScoreGauge value={d.overallScore} label="Overall" />{d.matchScore != null && <ScoreGauge value={d.matchScore} label="Job match" />}</div></Card>
        <Card title="Section scores" className="md:col-span-2"><ul className="space-y-2 text-sm">{sec.map(([k, v]) => <li key={k}><div className="flex justify-between"><span className="capitalize">{k.replace(/([A-Z])/g, ' $1')}</span><b>{v}</b></div><div className="mt-1 h-1.5 rounded bg-slate-100"><div className={cx('h-full rounded', v >= 75 ? 'bg-emerald-500' : v >= 50 ? 'bg-amber-500' : 'bg-red-500')} style={{ width: `${v}%` }} /></div></li>)}</ul></Card>
      </div>
      {d.type === 'JD_MATCH' && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card title={`Matched skills (${r.matchedSkills.length})`}>{r.matchedSkills.length === 0 ? <p className="text-sm text-slate-500">None of the job's listed skills were found on your resume.</p> : <ul className="space-y-2 text-sm">{r.matchedSkills.map((m: any) => <li key={m.skill}><span className="inline-flex items-center gap-1 font-medium text-emerald-700"><CheckCircle2 className="h-4 w-4" />{m.skill}</span> {m.importance === 'REQUIRED' && <Badge tone="bg-emerald-50 text-emerald-700">required</Badge>}{m.evidence && <div className="ml-5 text-xs text-slate-500">“{m.evidence}”</div>}</li>)}</ul>}</Card>
          <Card title={`Missing skills (${r.missingRequired.length + r.missingPreferred.length})`}>
            <ul className="space-y-3 text-sm">{[...r.missingRequired, ...r.missingPreferred].map((m: any) => (
              <li key={m.skill}><span className="inline-flex items-center gap-1 font-medium text-red-700"><XCircle className="h-4 w-4" />{m.skill}</span> <Badge tone={m.importance === 'REQUIRED' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600'}>{m.importance.toLowerCase()}</Badge>
                {m.inStudyMaterials && m.material && <div className="ml-5 mt-0.5 text-xs text-indigo-700">📚 In your notes: {m.material.title}, p.{m.material.pageStart}</div>}
                {m.resources?.length > 0 && <div className="ml-5 mt-0.5 text-xs">{m.resources.map((x: any) => <a key={x.url} href={x.url} target="_blank" rel="noopener noreferrer" className="mr-3 text-emerald-700 underline">{x.title}</a>)}</div>}</li>))}
              {r.missingRequired.length + r.missingPreferred.length === 0 && <p className="text-slate-500">No gaps found. 🎉</p>}</ul>
          </Card>
        </div>
      )}
      <Card title="Checks"><ul className="grid gap-1.5 text-sm sm:grid-cols-2">{r.checks.map((c: any) => <li key={c.id} className="flex items-start gap-2">{c.passed ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />}<span className={c.passed ? 'text-slate-600' : 'text-slate-800'}>{c.detail}</span></li>)}</ul></Card>
      <Card title="Suggestions"><ul className="space-y-2 text-sm">{r.suggestions.map((s: any, i: number) => <li key={i} className="flex gap-2"><Badge tone={s.priority === 'HIGH' ? 'bg-red-50 text-red-700' : s.priority === 'LOW' ? 'bg-slate-100 text-slate-600' : 'bg-amber-50 text-amber-700'}>{s.priority}</Badge><span><b>{s.section}</b> — {s.text}</span></li>)}</ul></Card>
      {r.bulletRewrites?.length > 0 && <Card title="Suggested bullet rewrites"><ul className="space-y-3 text-sm">{r.bulletRewrites.map((b: any, i: number) => <li key={i}><div className="text-slate-500 line-through">{b.original}</div><div className="text-emerald-800">{b.improved}</div></li>)}</ul><p className="mt-2 text-xs text-slate-500">Replace [X] placeholders with your real numbers; don't invent metrics.</p></Card>}
      <Card title="Create a learning roadmap from this analysis">
        <div className="flex flex-wrap items-end gap-3"><Input label="Target role" value={role} onChange={(e) => setRole(e.target.value)} placeholder={d.jobTitle ?? 'Backend Developer'} /><Input label="Weeks" type="number" min={1} max={24} value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} className="w-24" /><Input label="Hours / week" type="number" min={1} max={60} value={hours} onChange={(e) => setHours(Number(e.target.value))} className="w-28" />
          <Button accent="emerald" loading={make.isPending || (!!jobId && j?.status !== 'FAILED' && j?.status !== 'SUCCEEDED')} onClick={() => make.mutate()}>Generate roadmap</Button></div>
        {j?.status === 'FAILED' && <div className="mt-3"><ErrorBox error={j.errorMessage} /></div>}{make.error && <div className="mt-3"><ErrorBox error={make.error} /></div>}
      </Card>
    </div>
  )
}

/* ---------------- jobs ---------------- */
function JobsPage() {
  const qc = useQueryClient()
  const [form, setForm] = useState({ title: '', company: '', rawText: '' })
  const [open, setOpen] = useState<string | null>(null)
  const list = useQuery({ queryKey: ['jds'], queryFn: () => api.get('/career/job-descriptions') })
  const detail = useQuery({ queryKey: ['jd', open], enabled: !!open, queryFn: () => api.get(`/career/job-descriptions/${open}`) })
  const create = useMutation({ mutationFn: () => api.post('/career/job-descriptions', form), onSuccess: (x: any) => { setForm({ title: '', company: '', rawText: '' }); qc.invalidateQueries({ queryKey: ['jds'] }); setOpen(x.id) } })
  const del = useMutation({ mutationFn: (id: string) => api.del(`/career/job-descriptions/${id}`), onSuccess: () => { setOpen(null); qc.invalidateQueries({ queryKey: ['jds'] }) } })
  const resumes = useQuery({ queryKey: ['resumes'], queryFn: () => api.get('/career/resumes') })
  const nav = useNavigate()
  const d = detail.data as any
  return (
    <div className="mx-auto grid max-w-6xl gap-5 p-6 lg:grid-cols-2">
      <div className="space-y-4">
        <Card title="Add a job description">
          <div className="space-y-3"><div className="grid gap-3 sm:grid-cols-2"><Input label="Title (optional)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /><Input label="Company (optional)" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></div>
            <label className="block text-sm"><span className="mb-1 block font-medium">Paste the job description</span><textarea className="h-48 w-full rounded-lg border border-slate-300 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200" value={form.rawText} onChange={(e) => setForm({ ...form, rawText: e.target.value })} maxLength={20000} /></label>
            {create.error && <ErrorBox error={create.error} />}<Button accent="emerald" loading={create.isPending} disabled={form.rawText.trim().length < 40} onClick={() => create.mutate()}>Parse & save</Button></div>
        </Card>
        <Card title="Saved jobs">{list.isLoading ? <Spinner /> : ((list.data as any[]) ?? []).length === 0 ? <p className="text-sm text-slate-500">Nothing saved yet.</p> : <ul className="divide-y divide-slate-100">{(list.data as any[]).map((j) => <li key={j.id} className="flex items-center justify-between py-2 text-sm"><button className="text-left font-medium hover:underline" onClick={() => setOpen(j.id)}>{j.title ?? 'Untitled'}{j.company ? ` — ${j.company}` : ''}</button><button aria-label="Delete job" className="p-1 text-slate-400 hover:text-red-600" onClick={() => confirm('Delete this job description?') && del.mutate(j.id)}><Trash2 className="h-4 w-4" /></button></li>)}</ul>}</Card>
      </div>
      <div>{open && (detail.isLoading ? <Spinner /> : d && (
        <Card title={`${d.title ?? 'Untitled'}${d.company ? ` — ${d.company}` : ''}`}>
          <div className="space-y-3 text-sm">
            <div><div className="mb-1 font-medium">Required skills</div><div className="flex flex-wrap gap-1.5">{d.parsed.requiredSkills.map((s: any) => <span key={s.name} className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">{s.name}</span>)}{d.parsed.requiredSkills.length === 0 && <span className="text-slate-500">none detected</span>}</div></div>
            <div><div className="mb-1 font-medium">Preferred skills</div><div className="flex flex-wrap gap-1.5">{d.parsed.preferredSkills.map((s: any) => <span key={s.name} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs">{s.name}</span>)}{d.parsed.preferredSkills.length === 0 && <span className="text-slate-500">none detected</span>}</div></div>
            {d.parsed.responsibilities?.length > 0 && <div><div className="mb-1 font-medium">Responsibilities</div><ul className="ml-4 list-disc text-slate-600">{d.parsed.responsibilities.slice(0, 8).map((r: string, i: number) => <li key={i}>{r}</li>)}</ul></div>}
            {d.parsed.minExperienceYears != null && <div>Experience: <b>{d.parsed.minExperienceYears}+ years</b></div>}
            {!d.parsed.llm && <p className="text-xs text-slate-500">Parsed with the basic skill matcher (no LLM available).</p>}
            <div className="flex gap-2 pt-2">{((resumes.data as any[]) ?? []).filter((r) => r.parseStatus === 'PARSED').slice(0, 1).map((r) => <Button key={r.id} accent="emerald" onClick={() => nav(`/app/career/resumes/${r.id}`)}>Match with my resume</Button>)}</div>
          </div>
        </Card>))}</div>
    </div>
  )
}

/* ---------------- roadmaps ---------------- */
function RoadmapsPage() {
  const list = useQuery({ queryKey: ['roadmaps'], queryFn: () => api.get('/career/roadmaps') })
  const items: any[] = (list.data as any[]) ?? []
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-xl font-bold">Career roadmaps</h1>
      {list.isLoading ? <Spinner /> : items.length === 0 ? <EmptyState icon={<MapIcon className="h-8 w-8" />} title="No roadmaps yet" hint="Run a job match on your resume, then generate a roadmap from the missing skills." /> : <Card><ul className="divide-y divide-slate-100">{items.map((r) => <li key={r.id} className="py-3"><Link to={`/app/career/roadmaps/${r.id}`} className="flex items-center justify-between text-sm font-medium hover:underline"><span>{r.targetRole} <span className="font-normal text-slate-400">· {r.durationWeeks} weeks</span></span><Badge>{r.status}</Badge></Link><div className="mt-2 flex items-center gap-2"><ProgressBar pct={r.progressPct} /><span className="text-xs text-slate-500">{r.progressPct}%</span></div></li>)}</ul></Card>}
    </div>
  )
}

function RoadmapPage() {
  const { id } = useParams()
  const qc = useQueryClient()
  const nav = useNavigate()
  const r = useQuery({ queryKey: ['roadmap', id], queryFn: () => api.get(`/career/roadmaps/${id}`) })
  const set = useMutation({ mutationFn: (v: { item: string; status: string }) => api.patch(`/career/roadmaps/${id}/items/${v.item}`, { status: v.status }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['roadmap', id] }); qc.invalidateQueries({ queryKey: ['roadmaps'] }) } })
  const del = useMutation({ mutationFn: () => api.del(`/career/roadmaps/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['roadmaps'] }); nav('/app/career/roadmaps') } })
  if (r.isLoading) return <Spinner />
  if (r.error) return <div className="p-6"><ErrorBox error={r.error} /></div>
  const d = r.data as any
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <div className="flex items-start justify-between"><div><Link to="/app/career/roadmaps" className="text-xs text-emerald-600">← Roadmaps</Link><h1 className="text-xl font-bold">{d.targetRole}</h1><div className="mt-2 flex items-center gap-2"><div className="w-48"><ProgressBar pct={d.progressPct} /></div><span className="text-sm text-slate-500">{d.progressPct}% complete · {d.hoursPerWeek} h/week</span></div></div><Button variant="ghost" aria-label="Delete roadmap" onClick={() => confirm('Delete this roadmap?') && del.mutate()}><Trash2 className="h-4 w-4" /></Button></div>
      <div className="grid gap-4 md:grid-cols-2">{d.weeks.map((w: any) => (
        <Card key={w.weekNo} title={`Week ${w.weekNo}`}>
          <ul className="space-y-3">{w.items.map((it: any) => (
            <li key={it.id} className="text-sm"><label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={it.status === 'DONE'} onChange={(e) => set.mutate({ item: it.id, status: e.target.checked ? 'DONE' : 'TODO' })} /><span className={it.status === 'DONE' ? 'text-slate-400 line-through' : ''}><b>{it.title}</b>{it.skill && <Badge tone="bg-emerald-50 text-emerald-700">{it.skill}</Badge>}<span className="block text-slate-600">{it.description}</span></span></label>
              {it.linkedTopics?.length > 0 && <div className="ml-6 mt-1 text-xs text-indigo-700">📚 In your notes: {it.linkedTopics.map((t: any) => <Link key={t.id} className="mr-2 underline" to={`/app/study/documents/${t.documentId}`}>{t.title}</Link>)}</div>}
              {it.resources?.length > 0 && <div className="ml-6 mt-1 text-xs">{it.resources.map((x: any) => <a key={x.url} href={x.url} target="_blank" rel="noopener noreferrer" className="mr-3 text-emerald-700 underline">{x.title}</a>)}</div>}</li>))}</ul>
        </Card>))}</div>
    </div>
  )
}

/* ---------------- interviews ---------------- */
function InterviewsPage() {
  const nav = useNavigate()
  const jds = useQuery({ queryKey: ['jds'], queryFn: () => api.get('/career/job-descriptions') })
  const resumes = useQuery({ queryKey: ['resumes'], queryFn: () => api.get('/career/resumes') })
  const hist = useQuery({ queryKey: ['interviews'], queryFn: () => api.get('/career/interviews') })
  const [f, setF] = useState({ type: 'TECHNICAL', targetRole: '', jobDescriptionId: '', resumeId: '', difficulty: 'MEDIUM', numQuestions: 5 })
  const [bank, setBank] = useState<any[] | null>(null)
  const [topic, setTopic] = useState('')
  const start = useMutation({ mutationFn: () => api.post('/career/interviews', { ...f, jobDescriptionId: f.jobDescriptionId || undefined, resumeId: f.resumeId || undefined }), onSuccess: (x: any) => nav(`/app/career/interviews/${x.sessionId}`) })
  const gen = useMutation({ mutationFn: () => api.post('/career/interview-questions', { type: f.type === 'HR' ? 'HR' : 'TECHNICAL', topic, count: 8, difficulty: f.difficulty, jobDescriptionId: f.jobDescriptionId || undefined }), onSuccess: (x: any) => setBank(x) })
  return (
    <div className="mx-auto grid max-w-6xl gap-5 p-6 lg:grid-cols-2">
      <div className="space-y-4">
        <Card title="Start a mock interview">
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2"><Select label="Type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="TECHNICAL">Technical</option><option value="HR">HR / behavioural</option><option value="MIXED">Mixed</option></Select><Select label="Difficulty" value={f.difficulty} onChange={(e) => setF({ ...f, difficulty: e.target.value })}><option>EASY</option><option>MEDIUM</option><option>HARD</option></Select></div>
            <Input label="Target role" value={f.targetRole} onChange={(e) => setF({ ...f, targetRole: e.target.value })} placeholder="e.g. Backend Developer Intern" />
            <div className="grid gap-3 sm:grid-cols-2"><Select label="Use job description" value={f.jobDescriptionId} onChange={(e) => setF({ ...f, jobDescriptionId: e.target.value })}><option value="">None</option>{((jds.data as any[]) ?? []).map((j) => <option key={j.id} value={j.id}>{j.title ?? 'Untitled'}</option>)}</Select>
              <Select label="Use resume" value={f.resumeId} onChange={(e) => setF({ ...f, resumeId: e.target.value })}><option value="">None</option>{((resumes.data as any[]) ?? []).filter((r) => r.parseStatus === 'PARSED').map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</Select></div>
            <Input label="Number of questions (1–10)" type="number" min={1} max={10} value={f.numQuestions} onChange={(e) => setF({ ...f, numQuestions: Number(e.target.value) })} />
            {start.error && <ErrorBox error={start.error} />}<Button accent="emerald" loading={start.isPending} onClick={() => start.mutate()}><Mic className="h-4 w-4" />Start interview</Button>
          </div>
        </Card>
        <Card title="Past interviews">{((hist.data as any[]) ?? []).length === 0 ? <p className="text-sm text-slate-500">No interviews yet.</p> : <ul className="divide-y divide-slate-100">{(hist.data as any[]).map((h) => <li key={h.id} className="flex items-center justify-between py-2 text-sm"><Link className="font-medium hover:underline" to={`/app/career/interviews/${h.id}`}>{h.type} · {h.targetRole ?? 'general'}</Link><span className="flex items-center gap-2"><Badge>{h.status}</Badge>{h.overallScore != null && <b>{h.overallScore}/100</b>}</span></li>)}</ul>}</Card>
      </div>
      <Card title="Question bank">
        <div className="flex items-end gap-2"><Input label="Topic (optional)" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. DBMS, Java collections" /><Button accent="emerald" loading={gen.isPending} onClick={() => gen.mutate()}>Generate</Button></div>
        {gen.error && <div className="mt-3"><ErrorBox error={gen.error} /></div>}
        {bank && <ol className="mt-4 space-y-3 text-sm">{bank.map((q, i) => <li key={i} className="rounded-lg border border-slate-200 p-3"><div className="flex items-start justify-between gap-2"><b>{i + 1}. {q.question}</b><Badge tone="bg-slate-100 text-slate-600">{q.category}</Badge></div>{q.hint && <div className="mt-1 text-xs text-slate-500">Hint: {q.hint}</div>}{q.modelAnswerOutline && <details className="mt-1 text-xs"><summary className="cursor-pointer text-emerald-700">Answer outline</summary><div className="mt-1 whitespace-pre-wrap text-slate-600">{q.modelAnswerOutline}</div></details>}</li>)}</ol>}
      </Card>
    </div>
  )
}

function InterviewSession() {
  const { id } = useParams()
  const qc = useQueryClient()
  const s = useQuery({ queryKey: ['interview', id], queryFn: () => api.get(`/career/interviews/${id}`) })
  const [answer, setAnswer] = useState('')
  const [last, setLast] = useState<any>(null)
  const submit = useMutation({
    mutationFn: () => api.post(`/career/interviews/${id}/answers`, { questionId: (s.data as any).next.id, answer }),
    onSuccess: (r: any) => { setLast(r); setAnswer(''); qc.invalidateQueries({ queryKey: ['interview', id] }); qc.invalidateQueries({ queryKey: ['interviews'] }) },
  })
  const end = useMutation({ mutationFn: () => api.post(`/career/interviews/${id}/end`), onSuccess: () => qc.invalidateQueries({ queryKey: ['interview', id] }) })
  if (s.isLoading) return <Spinner />
  if (s.error) return <div className="p-6"><ErrorBox error={s.error} /></div>
  const d = s.data as any
  const answered = d.questions.filter((q: any) => q.answer)
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-center justify-between"><div><Link to="/app/career/interviews" className="text-xs text-emerald-600">← Interviews</Link><h1 className="text-xl font-bold">{d.type} interview · {d.targetRole ?? 'general'}</h1></div><Badge>{d.status}</Badge></div>
      {answered.map((q: any) => (
        <div key={q.id} className="space-y-2">
          <div className="rounded-xl bg-slate-100 px-4 py-2 text-sm"><span className="mr-2 text-xs font-semibold uppercase text-slate-500">{q.parentId ? 'Follow-up' : q.category}</span>{q.question}</div>
          <div className="ml-8 rounded-xl bg-emerald-600 px-4 py-2 text-sm text-white">{q.answer}</div>
          {q.scores && <Card className="ml-8"><div className="flex flex-wrap gap-4 text-sm">{Object.entries(q.scores).map(([k, v]) => <div key={k}><span className="capitalize text-slate-500">{k}</span> <b>{String(v)}/5</b></div>)}</div>{q.feedback && <p className="mt-2 text-sm text-slate-700">{q.feedback}</p>}</Card>}
        </div>
      ))}
      {d.status === 'IN_PROGRESS' && d.next && (
        <Card>
          <div className="mb-3 text-sm"><span className="mr-2 text-xs font-semibold uppercase text-slate-500">{d.next.isFollowUp ? 'Follow-up' : d.next.category}</span><b>{d.next.text}</b></div>
          <textarea className="h-36 w-full rounded-lg border border-slate-300 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200" placeholder="Type your answer as you would say it in the interview…" value={answer} onChange={(e) => setAnswer(e.target.value)} maxLength={6000} aria-label="Your answer" />
          {submit.error && <div className="mt-2"><ErrorBox error={submit.error} /></div>}
          <div className="mt-3 flex justify-between"><Button variant="ghost" onClick={() => confirm('End the interview now?') && end.mutate()} loading={end.isPending}>End interview</Button><Button accent="emerald" loading={submit.isPending} disabled={answer.trim().length < 3} onClick={() => submit.mutate()}>Submit answer</Button></div>
        </Card>
      )}
      {d.status !== 'IN_PROGRESS' && d.report && (
        <Card title="Interview report"><div className="flex items-center gap-6"><ScoreGauge value={d.overallScore} label="Overall" /><div className="grid flex-1 gap-3 text-sm sm:grid-cols-2">
          <div><div className="mb-1 font-semibold text-emerald-700">Strengths</div><ul className="ml-4 list-disc">{d.report.strengths?.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul></div>
          <div><div className="mb-1 font-semibold text-amber-700">Improve</div><ul className="ml-4 list-disc">{d.report.improvements?.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul></div></div></div>
          {d.report.perCategory && <div className="mt-3 flex flex-wrap gap-3 text-sm">{Object.entries(d.report.perCategory).map(([k, v]) => <span key={k} className="rounded-full bg-slate-100 px-3 py-1">{k}: <b>{String(v)}</b></span>)}</div>}</Card>
      )}
      {d.status === 'ABANDONED' && <p className="text-sm text-slate-500">This interview ended before any question was answered.</p>}
    </div>
  )
}
