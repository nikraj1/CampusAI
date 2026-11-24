import { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, useEffect } from 'react'
import { Loader2, AlertTriangle, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function cx(...a: (string | false | null | undefined)[]) { return a.filter(Boolean).join(' ') }

export type Accent = 'indigo' | 'emerald' | 'amber' | 'slate'
export const accentCls: Record<Accent, { bg: string; text: string; soft: string; ring: string; border: string }> = {
  indigo: { bg: 'bg-indigo-600 hover:bg-indigo-700', text: 'text-indigo-600', soft: 'bg-indigo-50 text-indigo-700', ring: 'focus:ring-indigo-500', border: 'border-indigo-200' },
  emerald: { bg: 'bg-emerald-600 hover:bg-emerald-700', text: 'text-emerald-600', soft: 'bg-emerald-50 text-emerald-700', ring: 'focus:ring-emerald-500', border: 'border-emerald-200' },
  amber: { bg: 'bg-amber-600 hover:bg-amber-700', text: 'text-amber-600', soft: 'bg-amber-50 text-amber-700', ring: 'focus:ring-amber-500', border: 'border-amber-200' },
  slate: { bg: 'bg-slate-800 hover:bg-slate-900', text: 'text-slate-700', soft: 'bg-slate-100 text-slate-700', ring: 'focus:ring-slate-500', border: 'border-slate-200' },
}

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> { accent?: Accent; variant?: 'solid' | 'ghost' | 'outline' | 'danger'; loading?: boolean; small?: boolean }
export function Button({ accent = 'indigo', variant = 'solid', loading, small, className, children, disabled, ...p }: BtnProps) {
  const a = accentCls[accent]
  const base = 'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-1 ' + a.ring
  const size = small ? 'px-2.5 py-1.5 text-xs' : 'px-4 py-2 text-sm'
  const v = variant === 'solid' ? `${a.bg} text-white shadow-sm`
    : variant === 'danger' ? 'bg-red-600 hover:bg-red-700 text-white'
    : variant === 'outline' ? 'border border-slate-300 bg-white hover:bg-slate-50 text-slate-700'
    : 'hover:bg-slate-100 text-slate-600'
  return <button className={cx(base, size, v, className)} disabled={disabled || loading} {...p}>{loading && <Loader2 className="h-4 w-4 animate-spin" />}{children}</button>
}

export function Input(p: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  const { label, className, ...rest } = p
  return (
    <label className="block text-sm">
      {label && <span className="mb-1 block font-medium text-slate-700">{label}</span>}
      <input className={cx('w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200', className)} {...rest} />
    </label>
  )
}

export function Select({ label, children, ...p }: React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return (
    <label className="block text-sm">
      {label && <span className="mb-1 block font-medium text-slate-700">{label}</span>}
      <select className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200" {...p}>{children}</select>
    </label>
  )
}

export function Card({ children, className, title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={cx('rounded-xl border border-slate-200 bg-white shadow-sm', className)}>
      {(title || action) && <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><h3 className="text-sm font-semibold text-slate-800">{title}</h3>{action}</header>}
      <div className="p-4">{children}</div>
    </section>
  )
}

const badgeColors: Record<string, string> = {
  READY: 'bg-emerald-50 text-emerald-700', PARSED: 'bg-emerald-50 text-emerald-700', SUCCEEDED: 'bg-emerald-50 text-emerald-700', COMPLETED: 'bg-emerald-50 text-emerald-700', DONE: 'bg-emerald-50 text-emerald-700',
  PROCESSING: 'bg-amber-50 text-amber-700', INDEXING: 'bg-amber-50 text-amber-700', QUEUED: 'bg-slate-100 text-slate-600', UPLOADED: 'bg-slate-100 text-slate-600', RUNNING: 'bg-amber-50 text-amber-700',
  GENERATING: 'bg-amber-50 text-amber-700', PENDING: 'bg-slate-100 text-slate-600', IN_PROGRESS: 'bg-amber-50 text-amber-700',
  FAILED: 'bg-red-50 text-red-700', ERROR: 'bg-red-50 text-red-700',
}
export function Badge({ children, tone }: { children: ReactNode; tone?: string }) {
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', tone ?? badgeColors[String(children)] ?? 'bg-slate-100 text-slate-600')}>{children}</span>
}

export function Spinner({ label }: { label?: string }) {
  return <div className="flex items-center gap-2 py-6 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />{label ?? 'Loading…'}</div>
}

export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  const msg = error instanceof Error ? error.message : String(error ?? 'Something went wrong')
  return (
    <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1">{msg}</div>
      {retry && <button onClick={retry} className="font-medium underline">Retry</button>}
    </div>
  )
}

export function EmptyState({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      {icon && <div className="mb-3 text-slate-400">{icon}</div>}
      <div className="text-sm font-medium text-slate-800">{title}</div>
      {hint && <div className="mt-1 max-w-sm text-sm text-slate-500">{hint}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className={cx('max-h-[90vh] w-full overflow-auto rounded-xl bg-white shadow-xl', wide ? 'max-w-3xl' : 'max-w-lg')} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

export function Drawer({ open, onClose, title, children, width = 'max-w-xl' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: string }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30" onMouseDown={onClose}>
      <aside className={cx('flex h-full w-full flex-col bg-white shadow-2xl', width)} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="min-w-0 truncate font-semibold">{title}</div>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </aside>
    </div>
  )
}

export function ProgressBar({ pct }: { pct: number }) {
  return <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} /></div>
}

/** Polls a job until it reaches a terminal state. */
export function useJob(jobId: string | null | undefined) {
  return useQuery({
    queryKey: ['job', jobId],
    enabled: !!jobId,
    queryFn: () => api.get(`/jobs/${jobId}`),
    refetchInterval: (q) => {
      const s = (q.state.data as any)?.status
      return s === 'SUCCEEDED' || s === 'FAILED' || s === 'CANCELLED' ? false : 1500
    },
  })
}

export function ScoreGauge({ value, label, size = 96 }: { value: number | null | undefined; label: string; size?: number }) {
  const v = value ?? 0
  const r = size / 2 - 8
  const c = 2 * Math.PI * r
  const color = v >= 75 ? '#059669' : v >= 50 ? '#d97706' : '#dc2626'
  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} role="img" aria-label={`${label}: ${value ?? 'n/a'}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth="8" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="fill-slate-800 text-lg font-semibold">{value == null ? '–' : Math.round(v)}</text>
      </svg>
      <div className="mt-1 text-xs text-slate-500">{label}</div>
    </div>
  )
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
export function fmtDate(s?: string) { return s ? new Date(s).toLocaleString() : '' }
