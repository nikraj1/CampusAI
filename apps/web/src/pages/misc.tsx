import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BookOpen, Briefcase, FolderGit2, Sparkles, ShieldCheck, Search, Bot, Trash2,
  MessageSquare, ArrowRight, CheckCircle2, Plus, ChevronRight, HardDrive, Cpu,
  FileText, Flame, Trophy, AlertTriangle, Lock, Sliders, User,
} from 'lucide-react'
import { api, useAuth } from '../lib/api'
import { Badge, Button, Card, ErrorBox, Input, ProgressBar, ScoreGauge, Select, Spinner, cx, fmtBytes, fmtDate } from '../components/ui'
import { ChatPanel } from '../components/ChatPanel'
import { ThemeToggle } from '../components/ThemeToggle'

export function Landing() {
  const user = useAuth((s) => s.user)
  const mods = [
    {
      icon: BookOpen,
      color: 'text-indigo-600 bg-indigo-50 border-indigo-200',
      badge: 'Hybrid RAG + Adaptive Quizzes',
      title: 'Study AI',
      text: 'Upload lecture notes and textbooks. Get cited answers with page numbers, topic summaries, verified MCQ quizzes, and mastery tracking — plus honest abstention when your notes don’t cover it.',
      points: ['Dense + full-text RRF retrieval', 'Clickable PDF page citations', 'Adaptive difficulty & mastery heatmaps'],
    },
    {
      icon: Briefcase,
      color: 'text-emerald-600 bg-emerald-50 border-emerald-200',
      badge: 'Resume + JD Match + Mock Interviews',
      title: 'Career AI',
      text: 'Analyse your resume with transparent rule-based scores, match it against real job descriptions, link skill gaps directly to your own study notes, and practise adaptive mock interviews.',
      points: ['PII-masked layout-aware parsing', 'Skill gaps linked to your notes', 'Rubric-scored mock interviews'],
    },
    {
      icon: FolderGit2,
      color: 'text-amber-600 bg-amber-50 border-amber-200',
      badge: 'Code Agent + Stack Trace Debug',
      title: 'Project AI',
      text: 'Index any public GitHub repository to explore architecture, locate symbols, paste stack traces to pinpoint root causes with verified file:line citations, and generate README/API docs.',
      points: ['Symbol & import-graph indexing', 'Verified file:line code citations', 'README, API & Architecture generator'],
    },
  ]

  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2.5 text-lg font-bold tracking-tight text-slate-900">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-sm">
              <Sparkles className="h-4 w-4" />
            </span>
            CampusAI
          </div>
          <div className="flex items-center gap-2.5">
            <ThemeToggle />
            {user ? (
              <Link to="/app"><Button>Open workspace <ArrowRight className="h-4 w-4" /></Button></Link>
            ) : (
              <>
                <Link to="/login"><Button variant="ghost">Sign in</Button></Link>
                <Link to="/register"><Button>Get started</Button></Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-grid-pattern">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-gradient-to-b from-indigo-50/80 via-white/40 to-transparent" />
        <div className="relative mx-auto max-w-5xl px-6 pb-16 pt-20 text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3.5 py-1 text-xs font-semibold text-indigo-700 shadow-sm">
            <Sparkles className="h-3.5 w-3.5" />
            Multi-Agent Student Copilot · Grounded &amp; Traced
          </div>
          <h1 className="mx-auto max-w-4xl text-4xl font-extrabold tracking-tight text-slate-900 sm:text-6xl sm:leading-[1.08]">
            An agentic copilot for{' '}
            <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">learning</span>,{' '}
            <span className="bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent">careers</span>{' '}
            and{' '}
            <span className="bg-gradient-to-r from-amber-500 to-orange-600 bg-clip-text text-transparent">projects</span>.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">
            Not just a generic chatbot: CampusAI routes your request to specialised agents that search your documents, inspect your repositories, and show every tool call and citation behind each answer.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link to={user ? '/app' : '/register'}>
              <Button className="px-6 py-3 text-sm font-semibold shadow-md">
                {user ? 'Open your workspace' : 'Create free account'}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            {!user && (
              <Link to="/login">
                <Button variant="outline" className="px-6 py-3 text-sm font-semibold">
                  Sign in
                </Button>
              </Link>
            )}
          </div>

          {/* Interactive-style orchestrator preview */}
          <div className="mx-auto mt-14 max-w-3xl rounded-3xl border border-slate-200 bg-white p-5 text-left shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 text-xs text-slate-500">
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                <span className="ml-2 font-mono text-[11px] font-medium text-slate-400">orchestrator · multi-step trace</span>
              </div>
              <Badge tone="bg-emerald-50 text-emerald-700">3 agents ready</Badge>
            </div>
            <div className="mt-4 space-y-3 text-xs sm:text-sm">
              <div className="ml-auto max-w-md rounded-2xl rounded-tr-sm bg-indigo-600 px-4 py-2.5 text-white shadow-sm">
                Review my resume against the Backend Intern JD and quiz me on my weakest skill from my OS notes.
              </div>
              <div className="flex flex-wrap gap-2 pl-2 text-[11px]">
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700">
                  <Briefcase className="h-3 w-3" /> Step 1 · Career Agent → match_resume_jd()
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 font-medium text-indigo-700">
                  <BookOpen className="h-3 w-3" /> Step 2 · Study Agent → hybrid_search("deadlocks")
                </span>
              </div>
              <div className="rounded-2xl rounded-tl-sm border border-slate-200 bg-slate-50 p-3.5 text-slate-700">
                Your resume matches <b>78%</b> of required skills. Gap detected: <b>Concurrency &amp; Deadlocks</b> — found in your uploaded notes{' '}
                <span className="rounded bg-indigo-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-indigo-700">OS_Unit3.pdf · p.14–16</span>. Ready to launch an adaptive 8-question quiz?
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Modules */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="mb-10 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Three specialised workspaces, one orchestrator</h2>
          <p className="mt-2 text-sm text-slate-500">Every module uses deterministic tools and retrieval before generating a single word.</p>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {mods.map((m) => (
            <div key={m.title} className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-slate-300 hover:shadow-lg">
              <div className="mb-4 flex items-center justify-between">
                <div className={`inline-flex rounded-xl border p-3 ${m.color}`}>
                  <m.icon className="h-6 w-6" />
                </div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600">{m.badge}</span>
              </div>
              <h3 className="text-lg font-bold text-slate-900">{m.title}</h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-600">{m.text}</p>
              <ul className="mt-5 space-y-2 border-t border-slate-100 pt-4 text-xs text-slate-600">
                {m.points.map((pt) => (
                  <li key={pt} className="flex items-center gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                    <span>{pt}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Trust pillars */}
      <section className="border-t border-slate-200/80 bg-slate-50 py-14">
        <div className="mx-auto grid max-w-5xl gap-8 px-6 text-sm text-slate-600 sm:grid-cols-3">
          <div className="flex gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><Search className="h-5 w-5" /></div>
            <div><div className="font-semibold text-slate-900">Grounded answers</div><p className="mt-1 text-xs leading-relaxed">Hybrid retrieval, clickable page &amp; line citations, support verification, and honest abstention.</p></div>
          </div>
          <div className="flex gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><Bot className="h-5 w-5" /></div>
            <div><div className="font-semibold text-slate-900">Transparent agents</div><p className="mt-1 text-xs leading-relaxed">Inspect the full execution trace — every tool call, latency, token count, and model used.</p></div>
          </div>
          <div className="flex gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600"><ShieldCheck className="h-5 w-5" /></div>
            <div><div className="font-semibold text-slate-900">Private by design</div><p className="mt-1 text-xs leading-relaxed">Strictly user-scoped retrieval, PII masking on resumes, and optional private-only LLM routing.</p></div>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200/80 bg-white py-6 text-center text-xs text-slate-400">
        CampusAI — Built for focused learning, career readiness, and engineering projects.
      </footer>
    </div>
  )
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

const modBadge: Record<string, string> = {
  STUDY: 'bg-indigo-50 text-indigo-700',
  CAREER: 'bg-emerald-50 text-emerald-700',
  PROJECT: 'bg-amber-50 text-amber-700',
  GENERAL: 'bg-slate-100 text-slate-700',
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
  const u = usage.data as any
  const storagePct = u?.storageQuotaBytes ? Math.min(100, Math.round((u.storageUsedBytes / u.storageQuotaBytes) * 100)) : 0
  const nav = useNavigate()

  const quick = [
    { to: '/app/study/library', label: 'Upload study notes', desc: 'Index PDFs & DOCX', icon: BookOpen, iconCls: 'bg-indigo-50 text-indigo-600', border: 'hover:border-indigo-300' },
    { to: '/app/career/resumes', label: 'Analyze resume', desc: 'Score & match JDs', icon: Briefcase, iconCls: 'bg-emerald-50 text-emerald-600', border: 'hover:border-emerald-300' },
    { to: '/app/projects', label: 'Index GitHub repo', desc: 'Explore & debug code', icon: FolderGit2, iconCls: 'bg-amber-50 text-amber-600', border: 'hover:border-amber-300' },
    { to: '/app/chat', label: 'Ask CampusAI', desc: 'Multi-agent chat', icon: Sparkles, iconCls: 'bg-indigo-50 text-indigo-600', border: 'hover:border-indigo-300' },
  ]

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      {/* Welcome Banner */}
      <div className="relative overflow-hidden rounded-3xl border border-indigo-200/70 bg-gradient-to-r from-indigo-50/80 via-white to-emerald-50/50 p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-indigo-600">{greeting()}</div>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
              Welcome back, {user?.fullName?.split(' ')[0]}
            </h1>
            <p className="mt-1 text-sm text-slate-600">Pick up where you left off across your study materials, career prep, and codebases.</p>
          </div>
          <Link to="/app/chat">
            <Button className="shadow-sm">
              <Sparkles className="h-4 w-4" />
              Ask CampusAI
            </Button>
          </Link>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {quick.map((q) => (
          <Link
            key={q.to}
            to={q.to}
            className={cx(
              'group flex items-center gap-3.5 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:shadow',
              q.border,
            )}
          >
            <div className={cx('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-transform group-hover:scale-105', q.iconCls)}>
              <q.icon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-slate-900">{q.label}</div>
              <div className="truncate text-xs text-slate-500">{q.desc}</div>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-700" />
          </Link>
        ))}
      </div>

      {/* 3 Module Snapshot Cards */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card
          title="Study mastery"
          icon={<BookOpen className="h-4 w-4 text-indigo-500" />}
          action={<Link className="text-xs font-semibold text-indigo-600 hover:underline" to="/app/study/progress">Details →</Link>}
        >
          {progress.isLoading ? <Spinner /> : (
            <div className="flex items-center gap-5">
              <ScoreGauge value={mastery} label="Overall" size={96} />
              <div className="min-w-0 flex-1 space-y-2 text-sm text-slate-600">
                <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs">
                  <span className="flex items-center gap-1.5 text-slate-500"><Trophy className="h-3.5 w-3.5 text-indigo-500" />Quizzes</span>
                  <b className="text-slate-900">{p?.quizzesTaken ?? 0}</b>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs">
                  <span className="flex items-center gap-1.5 text-slate-500"><Flame className="h-3.5 w-3.5 text-amber-500" />Streak</span>
                  <b className="text-slate-900">{p?.streakDays ?? 0}d</b>
                </div>
                {p?.weakTopics?.[0] && (
                  <div className="truncate text-xs text-slate-500">
                    Focus next: <b className="text-slate-800">{p.weakTopics[0].title}</b>
                  </div>
                )}
              </div>
            </div>
          )}
        </Card>

        <Card
          title="Career readiness"
          icon={<Briefcase className="h-4 w-4 text-emerald-500" />}
          action={<Link className="text-xs font-semibold text-emerald-600 hover:underline" to="/app/career">Open →</Link>}
        >
          {analyses.isLoading ? <Spinner /> : latest ? (
            <div className="flex items-center justify-around gap-3">
              <ScoreGauge value={latest.overallScore} label="Resume" size={92} />
              {latest.matchScore != null && <ScoreGauge value={latest.matchScore} label="Job match" size={92} />}
            </div>
          ) : (
            <div className="py-4 text-center text-sm text-slate-500">
              {(resumes.data as any[] | undefined)?.length
                ? 'Run an analysis on your resume to view scores here.'
                : 'Upload your resume to get an explainable readiness score.'}
            </div>
          )}
          {(roadmaps.data as any[] | undefined)?.[0] && (
            <div className="mt-4 rounded-xl bg-slate-50 p-3">
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="truncate font-medium text-slate-700">Roadmap: {(roadmaps.data as any[])[0].targetRole}</span>
                <b className="text-emerald-600">{(roadmaps.data as any[])[0].progressPct}%</b>
              </div>
              <ProgressBar pct={(roadmaps.data as any[])[0].progressPct} accent="emerald" />
            </div>
          )}
        </Card>

        <Card
          title="Indexed projects"
          icon={<FolderGit2 className="h-4 w-4 text-amber-500" />}
          action={<Link className="text-xs font-semibold text-amber-600 hover:underline" to="/app/projects">Open →</Link>}
        >
          {repos.isLoading ? <Spinner /> : (repos.data as any[]).length === 0 ? (
            <div className="py-6 text-center text-sm text-slate-500">
              No repositories indexed yet.
              <div className="mt-3"><Link to="/app/projects"><Button small accent="amber" variant="outline">Add repository</Button></Link></div>
            </div>
          ) : (
            <ul className="space-y-2 text-sm">
              {(repos.data as any[]).slice(0, 4).map((r) => (
                <li key={r.id}>
                  <Link
                    to={`/app/projects/${r.id}`}
                    className="flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 transition hover:bg-slate-50"
                  >
                    <span className="flex min-w-0 items-center gap-2 truncate font-medium text-slate-800">
                      <FolderGit2 className="h-4 w-4 shrink-0 text-amber-500" />
                      <span className="truncate">{r.fullName}</span>
                    </span>
                    <Badge>{r.indexStatus}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Bottom Row: Conversations & Usage */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Recent conversations" icon={<MessageSquare className="h-4 w-4 text-indigo-500" />} className="lg:col-span-2" noPad>
          {convs.isLoading ? <Spinner /> : ((convs.data as any)?.items ?? []).length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">No conversations yet. Start chatting in any workspace or Ask CampusAI.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {((convs.data as any).items as any[]).slice(0, 6).map((c) => (
                <li key={c.id}>
                  <button
                    className="group flex w-full items-center justify-between gap-3 px-5 py-3 text-left text-sm transition hover:bg-slate-50"
                    onClick={() => nav(c.module === 'GENERAL' ? `/app/chat/${c.id}` : c.module === 'STUDY' ? `/app/study?c=${c.id}` : c.module === 'CAREER' ? `/app/career?c=${c.id}` : `/app/projects/${c.scope?.repositoryId ?? ''}?c=${c.id}`)}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Badge tone={modBadge[c.module] ?? modBadge.GENERAL}>{c.module}</Badge>
                      <span className="truncate font-medium text-slate-800 group-hover:text-indigo-600">{c.title ?? 'Untitled conversation'}</span>
                    </div>
                    <span className="flex shrink-0 items-center gap-1.5 text-xs text-slate-400">
                      <span>{fmtDate(c.updatedAt)}</span>
                      <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Workspace usage" icon={<HardDrive className="h-4 w-4 text-slate-500" />}>
          {u ? (
            <div className="space-y-4">
              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-600">Storage used</span>
                  <span className="font-semibold text-slate-900">{fmtBytes(u.storageUsedBytes)} / {fmtBytes(u.storageQuotaBytes)}</span>
                </div>
                <ProgressBar pct={storagePct} accent="indigo" />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div className="rounded-xl bg-slate-50 p-3">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500"><FileText className="h-3.5 w-3.5 text-indigo-500" />Documents</div>
                  <div className="mt-1 text-lg font-bold text-slate-900">{u.documents}</div>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500"><Cpu className="h-3.5 w-3.5 text-emerald-500" />Tokens (24h)</div>
                  <div className="mt-1 text-lg font-bold text-slate-900">{Number(u.tokensToday ?? 0).toLocaleString()}</div>
                </div>
              </div>
            </div>
          ) : <Spinner />}
        </Card>
      </div>
    </div>
  )
}

export function UnifiedChat() {
  const { id } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const [filter, setFilter] = useState('')
  const list = useQuery({ queryKey: ['conversations', 'GENERAL'], queryFn: () => api.get('/conversations?module=GENERAL') })
  const del = useMutation({
    mutationFn: (cid: string) => api.del(`/conversations/${cid}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['conversations'] }); nav('/app/chat') },
  })
  const items: any[] = ((list.data as any)?.items ?? []).filter((c: any) => !filter.trim() || (c.title ?? 'Untitled').toLowerCase().includes(filter.toLowerCase()))

  return (
    <div className="flex h-full">
      <aside className="hidden w-72 shrink-0 flex-col border-r border-slate-200/80 bg-white lg:flex">
        <div className="space-y-2.5 border-b border-slate-100 p-3.5">
          <Button className="w-full" onClick={() => nav('/app/chat')}>
            <Plus className="h-4 w-4" />
            New conversation
          </Button>
          <Input placeholder="Filter chats…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter conversations" className="!py-1.5 text-xs" />
        </div>
        <ul className="flex-1 space-y-0.5 overflow-auto p-2.5">
          {items.length === 0 && <li className="px-3 py-6 text-center text-xs text-slate-400">No conversations yet.</li>}
          {items.map((c: any) => (
            <li
              key={c.id}
              className={cx(
                'group flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm transition',
                c.id === id ? 'bg-indigo-50 font-medium text-indigo-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
              )}
            >
              <button className="flex min-w-0 flex-1 items-center gap-2 truncate text-left" onClick={() => nav(`/app/chat/${c.id}`)}>
                <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-60" />
                <span className="truncate">{c.title ?? 'Untitled'}</span>
              </button>
              <button
                aria-label="Delete conversation"
                className="invisible rounded-lg p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600 group-hover:visible"
                onClick={() => del.mutate(c.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <div className="min-w-0 flex-1">
        <ChatPanel
          key={id ?? 'new'}
          module="GENERAL"
          conversationId={id ?? null}
          onConversation={(cid) => nav(`/app/chat/${cid}`, { replace: true })}
          placeholder="Ask about your notes, resume, or code. I'll route your question to the right agent and combine them when needed."
          suggestions={[
            'What can you do across Study, Career, and Project AI?',
            'Explain the difference between processes and threads',
            'Review my resume against my latest job description and quiz me on the weakest skill from my notes',
            'Where is authentication implemented in my repo?',
          ]}
        />
      </div>
    </div>
  )
}

export function SettingsPage() {
  const qc = useQueryClient()
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get('/users/me') })
  const usage = useQuery({ queryKey: ['usage'], queryFn: () => api.get('/users/me/usage') })
  const [form, setForm] = useState<any>(null)
  const [msg, setMsg] = useState<{ text: string; isErr?: boolean } | null>(null)
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' })
  const [delPw, setDelPw] = useState('')
  const nav = useNavigate()

  const save = useMutation({
    mutationFn: async () => {
      await api.patch('/users/me', { fullName: form.fullName })
      return api.put('/users/me/profile', { ...form.profile, preferences: form.profile.preferences ?? {} })
    },
    onSuccess: () => { setMsg({ text: 'Settings saved successfully.' }); qc.invalidateQueries({ queryKey: ['me'] }) },
    onError: (e: any) => setMsg({ text: e.message, isErr: true }),
  })
  const changePw = useMutation({
    mutationFn: () => api.put('/users/me/password', pw),
    onSuccess: () => { setMsg({ text: 'Password updated. Other sessions were signed out.' }); setPw({ currentPassword: '', newPassword: '' }) },
    onError: (e: any) => setMsg({ text: e.message, isErr: true }),
  })
  const delAcc = useMutation({
    mutationFn: () => api.del('/users/me', { password: delPw }),
    onSuccess: () => { useAuth.getState().set(null, null); nav('/') },
    onError: (e: any) => setMsg({ text: e.message, isErr: true }),
  })

  if (me.isLoading) return <Spinner />
  if (me.error) return <div className="p-6"><ErrorBox error={me.error} /></div>
  const f = form ?? { fullName: (me.data as any).fullName, profile: { ...(me.data as any).profile, preferences: (me.data as any).profile?.preferences ?? {} } }
  const setP = (k: string, v: any) => setForm({ ...f, profile: { ...f.profile, [k]: v } })
  const setPref = (k: string, v: any) => setForm({ ...f, profile: { ...f.profile, preferences: { ...f.profile.preferences, [k]: v } } })
  const u = usage.data as any

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500">Manage your academic profile, AI routing preferences, and account security.</p>
      </div>

      {msg && (
        <div
          className={cx(
            'animate-fade-in flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium',
            msg.isErr ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800',
          )}
          role="status"
        >
          {msg.isErr ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <CheckCircle2 className="h-4 w-4 shrink-0" />}
          {msg.text}
        </div>
      )}

      <Card title="Profile" icon={<User className="h-4 w-4 text-indigo-500" />}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Full name" value={f.fullName} onChange={(e) => setForm({ ...f, fullName: e.target.value })} />
          <Input label="College" value={f.profile.college ?? ''} onChange={(e) => setP('college', e.target.value)} />
          <Input label="Degree" value={f.profile.degree ?? ''} onChange={(e) => setP('degree', e.target.value)} />
          <Input label="Branch" value={f.profile.branch ?? ''} onChange={(e) => setP('branch', e.target.value)} />
          <Input label="Graduation year" type="number" value={f.profile.graduationYear ?? ''} onChange={(e) => setP('graduationYear', e.target.value)} />
          <Input label="Target role" value={f.profile.targetRole ?? ''} onChange={(e) => setP('targetRole', e.target.value)} />
          <Select label="Experience level" value={f.profile.experienceLevel ?? ''} onChange={(e) => setP('experienceLevel', e.target.value || null)}>
            <option value="">—</option>
            <option value="FRESHER">Fresher</option>
            <option value="INTERN">Intern</option>
            <option value="JUNIOR">Junior</option>
          </Select>
        </div>
        <div className="mt-5 flex justify-end"><Button loading={save.isPending} onClick={() => save.mutate()}>Save profile</Button></div>
      </Card>

      <Card title="AI preferences" icon={<Sliders className="h-4 w-4 text-indigo-500" />}>
        <div className="space-y-4 text-sm">
          <Select label="Answer style" value={f.profile.preferences.answerStyle ?? 'concise'} onChange={(e) => setPref('answerStyle', e.target.value)}>
            <option value="concise">Concise</option>
            <option value="detailed">Detailed with examples</option>
          </Select>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
            <input type="checkbox" className="mt-1 h-4 w-4 rounded accent-indigo-600" checked={!!f.profile.preferences.privateMode} onChange={(e) => setPref('privateMode', e.target.checked)} />
            <span>
              <b className="text-slate-900">Private mode</b>
              <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">
                Only use local or no-training LLM providers. If no private provider is available, requests fail rather than silently falling back to cloud tiers.
              </span>
            </span>
          </label>
        </div>
        <div className="mt-5 flex justify-end"><Button loading={save.isPending} onClick={() => save.mutate()}>Save preferences</Button></div>
      </Card>

      <Card title="Usage & quotas" icon={<HardDrive className="h-4 w-4 text-emerald-500" />}>
        {u && (
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-xl bg-slate-50 p-3.5"><div className="text-xs text-slate-500">Storage</div><div className="mt-1 font-bold text-slate-900">{fmtBytes(u.storageUsedBytes)} / {fmtBytes(u.storageQuotaBytes)}</div></div>
            <div className="rounded-xl bg-slate-50 p-3.5"><div className="text-xs text-slate-500">AI tokens (last 24h)</div><div className="mt-1 font-bold text-slate-900">{Number(u.tokensToday ?? 0).toLocaleString()}</div></div>
            <div className="rounded-xl bg-slate-50 p-3.5"><div className="text-xs text-slate-500">Study documents</div><div className="mt-1 font-bold text-slate-900">{u.documents}</div></div>
            <div className="rounded-xl bg-slate-50 p-3.5"><div className="text-xs text-slate-500">Repositories</div><div className="mt-1 font-bold text-slate-900">{u.repositories}</div></div>
          </div>
        )}
      </Card>

      <Card title="Security" icon={<Lock className="h-4 w-4 text-slate-500" />}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Current password" type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} autoComplete="current-password" />
          <Input label="New password (10+ chars)" type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} autoComplete="new-password" />
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="outline" loading={changePw.isPending} onClick={() => changePw.mutate()} disabled={!pw.currentPassword || pw.newPassword.length < 10}>
            Change password
          </Button>
        </div>
      </Card>

      <Card title="Danger zone" icon={<AlertTriangle className="h-4 w-4 text-red-500" />} className="border-red-200">
        <p className="mb-4 text-sm text-slate-600">
          Permanently deletes your account, documents, resumes, repositories, conversations, and all indexed data. This action cannot be undone.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <Input label="Confirm with your password" type="password" value={delPw} onChange={(e) => setDelPw(e.target.value)} />
          </div>
          <Button variant="danger" disabled={!delPw} loading={delAcc.isPending} onClick={() => confirm('Delete your account and ALL data permanently?') && delAcc.mutate()}>
            Delete account
          </Button>
        </div>
      </Card>
    </div>
  )
}
