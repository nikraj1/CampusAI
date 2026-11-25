import { FormEvent, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Sparkles, Eye, EyeOff, BookOpen, Briefcase, FolderGit2, ShieldCheck } from 'lucide-react'
import { authCall } from '../lib/api'
import { Button, ErrorBox, Input } from '../components/ui'
import { ThemeToggle } from '../components/ThemeToggle'

function strength(pw: string) {
  let s = 0
  if (pw.length >= 10) s++
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++
  if (/\d/.test(pw)) s++
  if (/[^A-Za-z0-9]/.test(pw)) s++
  return s
}

const strengthLabels = ['Too short', 'Weak', 'Fair', 'Good', 'Strong']

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const nav = useNavigate()
  const loc = useLocation() as any
  const reg = mode === 'register'

  async function submit(e: FormEvent) {
    e.preventDefault()
    setErr(null)
    if (reg && password.length < 10) { setErr(new Error('Password must be at least 10 characters')); return }
    setBusy(true)
    try {
      await authCall(mode, reg ? { email, password, fullName } : { email, password })
      nav(loc.state?.from ?? '/app', { replace: true })
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }

  const s = strength(password)

  return (
    <div className="relative flex min-h-screen bg-gradient-to-br from-indigo-50 via-white to-emerald-50">
      <div className="absolute right-4 top-4 z-10">
        <ThemeToggle />
      </div>

      {/* Left decorative showcase on desktop */}
      <div className="relative hidden flex-1 flex-col justify-between overflow-hidden bg-slate-950 p-12 text-white lg:flex">
        <div className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-indigo-600/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 right-0 h-96 w-96 rounded-full bg-emerald-500/20 blur-3xl" />
        <Link to="/" className="relative flex items-center gap-2.5 text-xl font-bold tracking-tight">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg">
            <Sparkles className="h-5 w-5 text-white" />
          </span>
          CampusAI
        </Link>

        <div className="relative max-w-md space-y-6">
          <h2 className="text-3xl font-extrabold leading-tight tracking-tight">
            One agentic workspace for your entire semester.
          </h2>
          <p className="text-sm leading-relaxed text-slate-300">
            Search your lecture notes with page-level citations, match your resume to real job descriptions, and debug GitHub repositories with verified line references.
          </p>
          <div className="space-y-3 pt-2 text-sm">
            {[
              { icon: BookOpen, color: 'text-indigo-400', title: 'Study AI', desc: 'Hybrid RAG, adaptive MCQ quizzes & mastery tracking' },
              { icon: Briefcase, color: 'text-emerald-400', title: 'Career AI', desc: 'Explainable resume scores, roadmaps & mock interviews' },
              { icon: FolderGit2, color: 'text-amber-400', title: 'Project AI', desc: 'Repo indexing, stack-trace debugging & doc generation' },
            ].map((item) => (
              <div key={item.title} className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 p-3.5 backdrop-blur-sm">
                <item.icon className={`mt-0.5 h-5 w-5 shrink-0 ${item.color}`} />
                <div>
                  <div className="font-semibold text-white">{item.title}</div>
                  <div className="text-xs text-slate-400">{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative flex items-center gap-2 text-xs text-slate-400">
          <ShieldCheck className="h-4 w-4 text-emerald-400" />
          <span>Your files, resumes, and repositories remain strictly private to your account.</span>
        </div>
      </div>

      {/* Right auth form */}
      <div className="flex flex-1 items-center justify-center p-6">
        <form
          onSubmit={submit}
          className="animate-scale-in w-full max-w-md space-y-5 rounded-3xl border border-slate-200/80 bg-white p-8 shadow-xl"
        >
          <div className="text-center">
            <Link to="/" className="mb-4 inline-flex items-center justify-center gap-2 text-xl font-bold lg:hidden">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white">
                <Sparkles className="h-4 w-4" />
              </span>
              CampusAI
            </Link>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              {reg ? 'Create your account' : 'Welcome back'}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {reg ? 'Start studying, preparing, and building smarter.' : 'Sign in to continue to your CampusAI workspace.'}
            </p>
          </div>

          <div className="space-y-4">
            {reg && (
              <Input
                label="Full name"
                placeholder="e.g. Nikhil Raj"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                maxLength={120}
                autoComplete="name"
              />
            )}
            <Input
              label="Email address"
              type="email"
              placeholder="you@university.edu"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
            <div>
              <div className="relative">
                <Input
                  label="Password"
                  type={showPw ? 'text' : 'password'}
                  placeholder={reg ? 'At least 10 characters' : '••••••••••'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete={reg ? 'new-password' : 'current-password'}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                  className="absolute right-2.5 top-[30px] rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {reg && password && (
                <div className="mt-2.5 space-y-1">
                  <div className="flex gap-1.5" aria-label="Password strength">
                    {[0, 1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className={`h-1.5 flex-1 rounded-full transition-colors ${i < s ? (s < 3 ? 'bg-amber-400' : 'bg-emerald-500') : 'bg-slate-200'}`}
                      />
                    ))}
                  </div>
                  <div className="flex justify-between text-[11px] text-slate-500">
                    <span>Strength: <b className={s >= 3 ? 'text-emerald-600' : 'text-amber-600'}>{strengthLabels[s]}</b></span>
                    <span>Min 10 characters</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {err != null && <ErrorBox error={err} />}

          <Button type="submit" loading={busy} className="w-full py-2.5">
            {reg ? 'Create free account' : 'Sign in'}
          </Button>

          <p className="text-center text-sm text-slate-500">
            {reg ? (
              <>Already have an account? <Link to="/login" className="font-semibold text-indigo-600 hover:underline">Sign in</Link></>
            ) : (
              <>New to CampusAI? <Link to="/register" className="font-semibold text-indigo-600 hover:underline">Create an account</Link></>
            )}
          </p>
        </form>
      </div>
    </div>
  )
}
