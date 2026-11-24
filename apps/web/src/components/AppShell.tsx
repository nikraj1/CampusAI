import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { LayoutDashboard, MessageSquare, BookOpen, Briefcase, FolderGit2, Settings, LogOut, Sparkles, Loader2, AlertTriangle } from 'lucide-react'
import { api, logout, useAuth } from '../lib/api'
import { cx } from './ui'
import { ThemeToggle } from './ThemeToggle'

const nav = [
  { to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true, color: 'text-slate-700' },
  { to: '/app/chat', label: 'Ask CampusAI', icon: MessageSquare, color: 'text-slate-700' },
  { to: '/app/study', label: 'Study AI', icon: BookOpen, color: 'text-indigo-600' },
  { to: '/app/career', label: 'Career AI', icon: Briefcase, color: 'text-emerald-600' },
  { to: '/app/projects', label: 'Project AI', icon: FolderGit2, color: 'text-amber-600' },
  { to: '/app/settings', label: 'Settings', icon: Settings, color: 'text-slate-700' },
]

function JobsIndicator() {
  const q = useQuery({ queryKey: ['jobs-active'], queryFn: () => api.get('/jobs?active=true'), refetchInterval: 4000 })
  const n = (q.data as any[] | undefined)?.length ?? 0
  if (!n) return null
  return <span className="flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700"><Loader2 className="h-3 w-3 animate-spin" />{n} background job{n > 1 ? 's' : ''} running</span>
}

export function AppShell() {
  const user = useAuth((s) => s.user)
  const navigate = useNavigate()
  const status = useQuery({ queryKey: ['system-status'], queryFn: () => api.get('/system/status'), refetchInterval: 30000 })
  const s = status.data as any
  return (
    <div className="flex h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="flex items-center gap-2 px-5 py-4"><Sparkles className="h-5 w-5 text-indigo-600" /><span className="text-lg font-bold tracking-tight">CampusAI</span></div>
        <nav className="flex-1 space-y-1 px-3" aria-label="Main">
          {nav.map(({ to, label, icon: Icon, end, color }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => cx('flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium', isActive ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50')}>
              <Icon className={cx('h-4 w-4', color)} />{label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-100 p-3">
          <div className="mb-2 truncate px-2 text-xs text-slate-500">{user?.fullName}<br />{user?.email}</div>
          <button onClick={async () => { await logout(); navigate('/login') }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"><LogOut className="h-4 w-4" />Sign out</button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5">
          <div className="md:hidden font-bold">CampusAI</div>
          <div className="hidden md:block" />
          <div className="flex items-center gap-3"><JobsIndicator /><ThemeToggle /></div>
        </header>
        {s && (!s.llmConfigured || s.ai !== 'UP') && (
          <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800" role="status">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {s.ai !== 'UP' ? 'The AI service is not reachable. AI features are unavailable.' : 'No LLM provider is configured, so chat, quizzes and AI-written feedback are disabled. Uploads, parsing and search still work. See the README to add a free API key or run Ollama.'}
          </div>
        )}
        <main className="min-h-0 flex-1 overflow-auto"><Outlet /></main>
        <nav className="flex border-t border-slate-200 bg-white md:hidden" aria-label="Mobile">
          {nav.slice(0, 5).map(({ to, icon: Icon, end, label }) => (
            <NavLink key={to} to={to} end={end} aria-label={label} className={({ isActive }) => cx('flex flex-1 items-center justify-center py-3', isActive ? 'text-indigo-600' : 'text-slate-500')}><Icon className="h-5 w-5" /></NavLink>
          ))}
        </nav>
      </div>
    </div>
  )
}
