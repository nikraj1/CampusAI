import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Briefcase, FolderGit2, Sparkles, ShieldCheck, Search, Bot, Trash2, MessageSquare } from 'lucide-react'
import { RadialBarChart, RadialBar, ResponsiveContainer } from 'recharts'
import { api, useAuth } from '../lib/api'
import { Button, Card, EmptyState, ErrorBox, Input, ScoreGauge, Select, Spinner, fmtBytes, fmtDate } from '../components/ui'
import { ChatPanel } from '../components/ChatPanel'
import { ThemeToggle } from '../components/ThemeToggle'

export function Landing() {
  const user = useAuth((s) => s.user)
  const mods = [
    { icon: BookOpen, color: 'text-indigo-600 bg-indigo-50', title: 'Study AI', text: 'Upload your notes and textbooks. Get cited answers with page numbers, summaries, adaptive quizzes and mastery tracking. When your material lacks the answer, it says so.' },
    { icon: Briefcase, color: 'text-emerald-600 bg-emerald-50', title: 'Career AI', text: 'Analyse your resume with explainable scores, match it to job descriptions, see skill gaps linked to your own notes, follow a roadmap and practise mock interviews.' },
    { icon: FolderGit2, color: 'text-amber-600 bg-amber-50', title: 'Project AI', text: 'Index a GitHub repository and ask where things are implemented, paste a stack trace to find the root cause, and generate README, API and architecture docs.' },
  ]
  return (
    <div className="min-h-screen bg-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2 text-xl font-bold"><Sparkles className="h-5 w-5 text-indigo-600" />CampusAI</div>
        <div className="flex items-center gap-2"><ThemeToggle />{user ? <Link to="/app"><Button>Open app</Button></Link> : <><Link to="/login"><Button variant="ghost">Sign in</Button></Link><Link to="/register"><Button>Get started</Button></Link></>}</div>
      </header>
      <section className="mx-auto max-w-4xl px-6 py-16 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">An agentic copilot for <span className="text-indigo-600">learning</span>, <span className="text-emerald-600">careers</span> and <span className="text-amber-600">projects</span>.</h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-slate-600">Not just a chatbot: CampusAI routes your request to specialised agents that search your documents, read your code and use tools, and shows every step it took.</p>
        <div className="mt-8 flex justify-center gap-3"><Link to="/register"><Button className="px-6 py-3">Create free account</Button></Link></div>
      </section>
      <section className="mx-auto grid max-w-6xl gap-5 px-6 pb-16 md:grid-cols-3">
        {mods.map((m) => (
          <div key={m.title} className="rounded-2xl border border-slate-200 p-6 shadow-sm">
            <div className={`mb-4 inline-flex rounded-xl p-3 ${m.color}`}><m.icon className="h-6 w-6" /></div>
            <h3 className="text-lg font-semibold">{m.title}</h3>
            <p className="mt-2 text-sm text-slate-600">{m.text}</p>
          </div>
        ))}
      </section>
      <section className="border-t border-slate-100 bg-slate-50 py-12">
        <div className="mx-auto grid max-w-5xl gap-6 px-6 sm:grid-cols-3 text-sm text-slate-600">
          <div className="flex gap-3"><Search className="h-5 w-5 shrink-0 text-indigo-500" /><span><b className="text-slate-800">Grounded answers.</b> Hybrid retrieval, page citations, citation checks and honest abstention.</span></div>
          <div className="flex gap-3"><Bot className="h-5 w-5 shrink-0 text-emerald-500" /><span><b className="text-slate-800">Transparent agents.</b> See the tools used and the model behind every answer.</span></div>
          <div className="flex gap-3"><ShieldCheck className="h-5 w-5 shrink-0 text-amber-500" /><span><b className="text-slate-800">Private by design.</b> Your documents and repositories are only retrievable by you. Optional private mode.</span></div>
        </div>
      </section>
    </div>
  )
}

export function Dashboard() {
  const user = useAuth((s) => s.user)
  const progress = useQuery({ queryKey: ['progress'], queryFn: () => api.get('/study/progress') })
  const convs = useQuery({ queryKey: ['conversations', 'recent'], queryFn: () => api.get('/conversations') })
  const resumes = useQuery({ queryKey: ['resumes'], queryFn: () => api.get('/career/resumes') })
  const analyses = useQuery({ queryKey: ['analyses'], queryFn: () => api.get('/career/analyses') })
  const roadmaps = useQuery({ queryKey: ['roadmaps'], queryFn: () => api.get('/career/roadmaps') })
  const repos = useQuery({ queryKey: ['repos'], queryFn: () => api.get('/projects/repositories') })
  const usage = useQuery({ queryKey: ['usage'], queryFn: () => api.get('/users/me/usage') })
  const p = progress.data as any
  const latest = (analyses.data as any[] | undefined)?.[0]
  const mastery = p?.overallMastery != null ? Math.round(p.overallMastery * 100) : null
  const nav = useNavigate()
  const quick = [
    { to: '/app/study/library', label: 'Upload study material', c: 'bg-indigo-50 text-indigo-700' },
    { to: '/app/career/resumes', label: 'Analyze my resume', c: 'bg-emerald-50 text-emerald-700' },
    { to: '/app/projects', label: 'Add a GitHub repo', c: 'bg-amber-50 text-amber-700' },
    { to: '/app/chat', label: 'Ask CampusAI anything', c: 'bg-slate-100 text-slate-700' },
  ]
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div><h1 className="text-2xl font-bold">Hi {user?.fullName?.split(' ')[0]} 👋</h1><p className="text-sm text-slate-500">Here's where you left off.</p></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{quick.map((q) => <Link key={q.to} to={q.to} className={`rounded-xl px-4 py-4 text-sm font-medium ${q.c} hover:opacity-90`}>{q.label} →</Link>)}</div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Study mastery" action={<Link className="text-xs text-indigo-600" to="/app/study/progress">Details</Link>}>
          {progress.isLoading ? <Spinner /> : (
            <div className="flex items-center gap-4">
              <ScoreGauge value={mastery} label="Overall mastery" />
              <div className="text-sm text-slate-600 space-y-1">
                <div>Quizzes taken: <b>{p?.quizzesTaken ?? 0}</b></div>
                <div>Streak: <b>{p?.streakDays ?? 0}</b> day(s)</div>
                {p?.weakTopics?.[0] && <div>Weakest: <b>{p.weakTopics[0].title}</b></div>}
              </div>
            </div>
          )}
        </Card>
        <Card title="Career readiness" action={<Link className="text-xs text-emerald-600" to="/app/career">Open</Link>}>
          {analyses.isLoading ? <Spinner /> : latest ? (
            <div className="flex items-center gap-4"><ScoreGauge value={latest.overallScore} label="Resume score" />{latest.matchScore != null && <ScoreGauge value={latest.matchScore} label="Job match" />}</div>
          ) : <p className="text-sm text-slate-500">{(resumes.data as any[] | undefined)?.length ? 'Run an analysis on your resume to see scores here.' : 'Upload a resume to get started.'}</p>}
          {(roadmaps.data as any[] | undefined)?.[0] && <div className="mt-3 text-sm text-slate-600">Roadmap “{(roadmaps.data as any[])[0].targetRole}”: <b>{(roadmaps.data as any[])[0].progressPct}%</b> done</div>}
        </Card>
        <Card title="Projects" action={<Link className="text-xs text-amber-600" to="/app/projects">Open</Link>}>
          {repos.isLoading ? <Spinner /> : (repos.data as any[]).length === 0 ? <p className="text-sm text-slate-500">No repositories yet.</p> : (
            <ul className="space-y-2 text-sm">{(repos.data as any[]).slice(0, 4).map((r) => <li key={r.id} className="flex justify-between"><Link className="font-medium hover:underline" to={`/app/projects/${r.id}`}>{r.fullName}</Link><span className="text-xs text-slate-500">{r.indexStatus}</span></li>)}</ul>
          )}
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Recent conversations" className="lg:col-span-2">
          {convs.isLoading ? <Spinner /> : ((convs.data as any)?.items ?? []).length === 0 ? <p className="text-sm text-slate-500">No conversations yet.</p> : (
            <ul className="divide-y divide-slate-100">{((convs.data as any).items as any[]).slice(0, 6).map((c) => (
              <li key={c.id}><button className="flex w-full items-center justify-between py-2 text-left text-sm hover:bg-slate-50" onClick={() => nav(c.module === 'GENERAL' ? `/app/chat/${c.id}` : c.module === 'STUDY' ? `/app/study?c=${c.id}` : c.module === 'CAREER' ? `/app/career?c=${c.id}` : `/app/projects/${c.scope?.repositoryId ?? ''}?c=${c.id}`)}>
                <span className="truncate"><MessageSquare className="mr-2 inline h-3.5 w-3.5 text-slate-400" />{c.title ?? 'Untitled'}</span><span className="ml-3 shrink-0 text-xs text-slate-400">{c.module} · {fmtDate(c.updatedAt)}</span></button></li>
            ))}</ul>
          )}
        </Card>
        <Card title="Usage">
          {usage.data && (
            <div className="space-y-2 text-sm text-slate-600">
              <div>Storage: <b>{fmtBytes((usage.data as any).storageUsedBytes)}</b> / {fmtBytes((usage.data as any).storageQuotaBytes)}</div>
              <div>Documents: <b>{(usage.data as any).documents}</b></div>
              <div>AI tokens (24h): <b>{(usage.data as any).tokensToday}</b></div>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

export function UnifiedChat() {
  const { id } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['conversations', 'GENERAL'], queryFn: () => api.get('/conversations?module=GENERAL') })
  const del = useMutation({ mutationFn: (cid: string) => api.del(`/conversations/${cid}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['conversations'] }); nav('/app/chat') } })
  return (
    <div className="flex h-full">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="p-3"><Button className="w-full" onClick={() => nav('/app/chat')}>New chat</Button></div>
        <ul className="flex-1 overflow-auto px-2 pb-3">
          {((list.data as any)?.items ?? []).map((c: any) => (
            <li key={c.id} className={`group flex items-center justify-between rounded-lg px-2 py-2 text-sm ${c.id === id ? 'bg-slate-100' : 'hover:bg-slate-50'}`}>
              <button className="min-w-0 flex-1 truncate text-left" onClick={() => nav(`/app/chat/${c.id}`)}>{c.title ?? 'Untitled'}</button>
              <button aria-label="Delete conversation" className="invisible p-1 text-slate-400 hover:text-red-600 group-hover:visible" onClick={() => del.mutate(c.id)}><Trash2 className="h-3.5 w-3.5" /></button>
            </li>
          ))}
        </ul>
      </aside>
      <div className="min-w-0 flex-1">
        <ChatPanel key={id ?? 'new'} module="GENERAL" conversationId={id ?? null} onConversation={(cid) => nav(`/app/chat/${cid}`, { replace: true })}
          placeholder="Ask about your notes, resume, or code. I'll route your question to the right agent, and can combine several."
          suggestions={['What can you do?', 'Explain the difference between processes and threads', 'Review my resume against my latest job description and quiz me on the weakest skill from my notes', 'Where is authentication implemented in my repo?']} />
      </div>
    </div>
  )
}

export function SettingsPage() {
  const qc = useQueryClient()
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get('/users/me') })
  const usage = useQuery({ queryKey: ['usage'], queryFn: () => api.get('/users/me/usage') })
  const [form, setForm] = useState<any>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' })
  const [delPw, setDelPw] = useState('')
  const nav = useNavigate()
  const save = useMutation({
    mutationFn: async () => { await api.patch('/users/me', { fullName: form.fullName }); return api.put('/users/me/profile', { ...form.profile, preferences: form.profile.preferences ?? {} }) },
    onSuccess: () => { setMsg('Saved'); qc.invalidateQueries({ queryKey: ['me'] }) }, onError: (e: any) => setMsg(e.message),
  })
  const changePw = useMutation({ mutationFn: () => api.put('/users/me/password', pw), onSuccess: () => { setMsg('Password changed. Other sessions were signed out.'); setPw({ currentPassword: '', newPassword: '' }) }, onError: (e: any) => setMsg(e.message) })
  const delAcc = useMutation({ mutationFn: () => api.del('/users/me', { password: delPw }), onSuccess: () => { useAuth.getState().set(null, null); nav('/') }, onError: (e: any) => setMsg(e.message) })
  if (me.isLoading) return <Spinner />
  if (me.error) return <ErrorBox error={me.error} />
  const f = form ?? { fullName: (me.data as any).fullName, profile: { ...(me.data as any).profile, preferences: (me.data as any).profile?.preferences ?? {} } }
  const setP = (k: string, v: any) => setForm({ ...f, profile: { ...f.profile, [k]: v } })
  const setPref = (k: string, v: any) => setForm({ ...f, profile: { ...f.profile, preferences: { ...f.profile.preferences, [k]: v } } })
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      {msg && <div className="rounded-lg bg-slate-100 px-3 py-2 text-sm" role="status">{msg}</div>}
      <Card title="Profile">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Full name" value={f.fullName} onChange={(e) => setForm({ ...f, fullName: e.target.value })} />
          <Input label="College" value={f.profile.college ?? ''} onChange={(e) => setP('college', e.target.value)} />
          <Input label="Degree" value={f.profile.degree ?? ''} onChange={(e) => setP('degree', e.target.value)} />
          <Input label="Branch" value={f.profile.branch ?? ''} onChange={(e) => setP('branch', e.target.value)} />
          <Input label="Graduation year" type="number" value={f.profile.graduationYear ?? ''} onChange={(e) => setP('graduationYear', e.target.value)} />
          <Input label="Target role" value={f.profile.targetRole ?? ''} onChange={(e) => setP('targetRole', e.target.value)} />
          <Select label="Experience level" value={f.profile.experienceLevel ?? ''} onChange={(e) => setP('experienceLevel', e.target.value || null)}><option value="">—</option><option value="FRESHER">Fresher</option><option value="INTERN">Intern</option><option value="JUNIOR">Junior</option></Select>
        </div>
        <div className="mt-4"><Button loading={save.isPending} onClick={() => save.mutate()}>Save profile</Button></div>
      </Card>
      <Card title="AI preferences">
        <div className="space-y-3 text-sm">
          <Select label="Answer style" value={f.profile.preferences.answerStyle ?? 'concise'} onChange={(e) => setPref('answerStyle', e.target.value)}><option value="concise">Concise</option><option value="detailed">Detailed with examples</option></Select>
          <label className="flex items-start gap-3"><input type="checkbox" className="mt-1" checked={!!f.profile.preferences.privateMode} onChange={(e) => setPref('privateMode', e.target.checked)} />
            <span><b>Private mode</b><br /><span className="text-slate-500">Only use local or no-training LLM providers. Free-tier cloud providers may use prompts to improve their products, so private mode refuses to use them. If no private provider is available, requests fail rather than silently falling back.</span></span></label>
        </div>
        <div className="mt-4"><Button loading={save.isPending} onClick={() => save.mutate()}>Save preferences</Button></div>
      </Card>
      <Card title="Usage & quotas">
        {usage.data && <div className="grid gap-2 text-sm sm:grid-cols-2"><div>Storage: <b>{fmtBytes((usage.data as any).storageUsedBytes)}</b> / {fmtBytes((usage.data as any).storageQuotaBytes)}</div><div>AI tokens (last 24h): <b>{(usage.data as any).tokensToday}</b></div><div>Study documents: <b>{(usage.data as any).documents}</b></div><div>Repositories: <b>{(usage.data as any).repositories}</b></div></div>}
      </Card>
      <Card title="Security">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Current password" type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} autoComplete="current-password" />
          <Input label="New password (10+ chars)" type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} autoComplete="new-password" />
        </div>
        <div className="mt-3"><Button variant="outline" loading={changePw.isPending} onClick={() => changePw.mutate()} disabled={!pw.currentPassword || pw.newPassword.length < 10}>Change password</Button></div>
      </Card>
      <Card title="Delete account">
        <p className="mb-3 text-sm text-slate-600">Permanently deletes your account, documents, resumes, repositories, conversations and all indexed data. This cannot be undone.</p>
        <div className="flex items-end gap-3"><Input label="Confirm with your password" type="password" value={delPw} onChange={(e) => setDelPw(e.target.value)} /><Button variant="danger" disabled={!delPw} loading={delAcc.isPending} onClick={() => confirm('Delete your account and ALL data permanently?') && delAcc.mutate()}>Delete</Button></div>
      </Card>
    </div>
  )
}
