import { FormEvent, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { authCall } from '../lib/api'
import { Button, ErrorBox, Input } from '../components/ui'

function strength(pw: string) {
  let s = 0
  if (pw.length >= 10) s++
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++
  if (/\d/.test(pw)) s++
  if (/[^A-Za-z0-9]/.test(pw)) s++
  return s
}

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
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
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-emerald-50 p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-lg">
        <Link to="/" className="flex items-center justify-center gap-2 text-xl font-bold"><Sparkles className="h-5 w-5 text-indigo-600" />CampusAI</Link>
        <h1 className="text-center text-lg font-semibold">{reg ? 'Create your account' : 'Welcome back'}</h1>
        {reg && <Input label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} required maxLength={120} autoComplete="name" />}
        <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        <div>
          <Input label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete={reg ? 'new-password' : 'current-password'} />
          {reg && password && (
            <div className="mt-2 flex gap-1" aria-label="Password strength">{[0, 1, 2, 3].map((i) => <div key={i} className={`h-1 flex-1 rounded ${i < s ? (s < 3 ? 'bg-amber-400' : 'bg-emerald-500') : 'bg-slate-200'}`} />)}</div>
          )}
          {reg && <p className="mt-1 text-xs text-slate-500">At least 10 characters.</p>}
        </div>
        {err != null && <ErrorBox error={err} />}
        <Button type="submit" loading={busy} className="w-full">{reg ? 'Sign up' : 'Sign in'}</Button>
        <p className="text-center text-sm text-slate-500">
          {reg ? <>Already have an account? <Link to="/login" className="font-medium text-indigo-600">Sign in</Link></> : <>New here? <Link to="/register" className="font-medium text-indigo-600">Create an account</Link></>}
        </p>
      </form>
    </div>
  )
}
