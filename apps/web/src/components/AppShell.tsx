import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  LayoutDashboard, MessageSquare, BookOpen, Briefcase, FolderGit2, Settings,
  LogOut, Sparkles, Loader2, AlertTriangle, CheckCircle2,
} from 'lucide-react'
import { api, logout, useAuth } from '../lib/api'
import { cx } from './ui'
import { ThemeToggle } from './ThemeToggle'

const navGroups = [
  {
    label: 'Overview',
    items: [
      { to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true, iconCls: 'text-indigo-600', activeBg: 'bg-indigo-50 text-indigo-700' },
      { to: '/app/chat', label: 'Ask CampusAI', icon: MessageSquare, iconCls: 'text-violet-600', activeBg: 'bg-indigo-50 text-indigo-700' },
    ],
  },
  {
    label: 'Workspaces',
    items: [
      { to: '/app/study', label: 'Study AI', icon: BookOpen, iconCls: 'text-indigo-600', activeBg: 'bg-indigo-50 text-indigo-700' },
      { to: '/app/career', label: 'Career AI', icon: Briefcase, iconCls: 'text-emerald-600', activeBg: 'bg-emerald-50 text-emerald-700' },
      { to: '/app/projects', label: 'Project AI', icon: FolderGit2, iconCls: 'text-amber-600', activeBg: 'bg-amber-50 text-amber-700' },
    ],
  },
  {
    label: 'Account',
    items: [
      { to: '/app/settings', label: 'Settings', icon: Settings, iconCls: 'text-slate-500', activeBg: 'bg-slate-100 text-slate-900' },
    ],
  },
]

const flatNav = navGroups.flatMap((g) => g.items)

function pageMeta(pathname: string) {
  if (pathname === '/app') return { title: 'Dashboard', subtitle: 'Overview & quick actions' }
  if (pathname.startsWith('/app/chat')) return { title: 'Ask CampusAI', subtitle: 'Multi-agent orchestrator' }
  if (pathname.startsWith('/app/study')) return { title: 'Study AI', subtitle: 'Notes, RAG & adaptive quizzes' }
  if (pathname.startsWith('/app/career')) return { title: 'Career AI', subtitle: 'Resumes, job match & interviews' }
  if (pathname.startsWith('/app/projects')) return { title: 'Project AI', subtitle: 'Codebase exploration & docs' }
  if (pathname.startsWith('/app/settings')) return { title: 'Settings', subtitle: 'Profile, AI preferences & security' }
  return { title: 'CampusAI', subtitle: '' }
}

function JobsIndicator() {
  const q = useQuery({ queryKey: ['jobs-active'], queryFn: () => api.get('/jobs?active=true'), refetchInterval: 4000 })
  const n = (q.data as any[] | undefined)?.length ?? 0
  if (!n) return null
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      {n} job{n > 1 ? 's' : ''} running
    </span>
  )
}

function initials(name?: string | null) {
  if (!name) return 'U'
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || 'U'
}

export function AppShell() {
  const user = useAuth((s) => s.user)
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const status = useQuery({ queryKey: ['system-status'], queryFn: () => api.get('/system/status'), refetchInterval: 30000 })
  const s = status.data as any
  const meta = pageMeta(pathname)
  const aiReady = s && s.ai === 'UP' && s.llmConfigured

  return (
    <div className="flex h-screen bg-slate-50">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200/80 bg-white md:flex">
        <div className="flex items-center gap-2.5 px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-sm">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="text-base font-bold tracking-tight text-slate-900">CampusAI</div>
            <div className="text-[11px] font-medium text-slate-400">Agentic Copilot</div>
          </div>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-2" aria-label="Main">
          {navGroups.map((group) => (
            <div key={group.label}>
              <div className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{group.label}</div>
              <div className="space-y-0.5">
                {group.items.map(({ to, label, icon: Icon, end, iconCls, activeBg }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    className={({ isActive }) =>
                      cx(
                        'group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-all',
                        isActive ? `${activeBg} shadow-sm` : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                      )
                    }
                  >
                    <Icon className={cx('h-4 w-4 shrink-0 transition-transform group-hover:scale-105', iconCls)} />
                    <span className="truncate">{label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-slate-100 p-3">
          <div className="mb-2 flex items-center gap-2.5 rounded-xl bg-slate-50 p-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-emerald-500 text-xs font-bold text-white shadow-sm">
              {initials(user?.fullName)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold text-slate-800">{user?.fullName}</div>
              <div className="truncate text-[11px] text-slate-500">{user?.email}</div>
            </div>
          </div>
          <button
            onClick={async () => { await logout(); navigate('/login') }}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-slate-500 transition hover:bg-red-50 hover:text-red-700"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200/80 bg-white/90 px-5 py-3 backdrop-blur-md">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 text-white md:hidden">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-bold text-slate-900">{meta.title}</h1>
              {meta.subtitle && <p className="hidden truncate text-[11px] text-slate-500 sm:block">{meta.subtitle}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <JobsIndicator />
            {aiReady && (
              <span className="hidden items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 sm:inline-flex" title="AI service & LLM connected">
                <CheckCircle2 className="h-3 w-3" />
                AI Ready
              </span>
            )}
            <ThemeToggle />
          </div>
        </header>

        {s && (!s.llmConfigured || s.ai !== 'UP') && (
          <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-5 py-2 text-xs font-medium text-amber-800" role="status">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {s.ai !== 'UP'
              ? 'The AI service is not reachable. AI features are unavailable.'
              : 'No LLM provider is configured, so chat, quizzes and AI-written feedback are disabled. Uploads, parsing and search still work.'}
          </div>
        )}

        <main className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </main>

        <nav className="flex border-t border-slate-200/80 bg-white md:hidden" aria-label="Mobile">
          {flatNav.slice(0, 5).map(({ to, icon: Icon, end, label }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              aria-label={label}
              className={({ isActive }) =>
                cx('flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium', isActive ? 'text-indigo-600' : 'text-slate-500')
              }
            >
              <Icon className="h-5 w-5" />
              <span>{label.split(' ')[0]}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  )
}
