import { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, useEffect } from 'react'
import { Loader2, AlertTriangle, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function cx(...a: (string | false | null | undefined)[]) { return a.filter(Boolean).join(' ') }

export type Accent = 'indigo' | 'emerald' | 'amber' | 'slate'
export const accentCls: Record<Accent, { bg: string; text: string; soft: string; ring: string; border: string; bar: string }> = {
  indigo: {
    bg: 'bg-indigo-600 hover:bg-indigo-700',
    text: 'text-indigo-600',
    soft: 'bg-indigo-50 text-indigo-700',
    ring: 'focus:ring-indigo-500/40',
    border: 'border-indigo-200',
    bar: 'bg-gradient-to-r from-indigo-500 to-violet-500',
  },
  emerald: {
    bg: 'bg-emerald-600 hover:bg-emerald-700',
    text: 'text-emerald-600',
    soft: 'bg-emerald-50 text-emerald-700',
    ring: 'focus:ring-emerald-500/40',
    border: 'border-emerald-200',
    bar: 'bg-gradient-to-r from-emerald-500 to-teal-500',
  },
  amber: {
    bg: 'bg-amber-600 hover:bg-amber-700',
    text: 'text-amber-600',
    soft: 'bg-amber-50 text-amber-700',
    ring: 'focus:ring-amber-500/40',
    border: 'border-amber-200',
    bar: 'bg-gradient-to-r from-amber-500 to-orange-500',
  },
  slate: {
    bg: 'bg-slate-800 hover:bg-slate-900',
    text: 'text-slate-700',
    soft: 'bg-slate-100 text-slate-700',
    ring: 'focus:ring-slate-500/40',
    border: 'border-slate-200',
    bar: 'bg-slate-700',
  },
}

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  accent?: Accent
  variant?: 'solid' | 'ghost' | 'outline' | 'danger'
  loading?: boolean
  small?: boolean
}
export function Button({ accent = 'indigo', variant = 'solid', loading, small, className, children, disabled, ...p }: BtnProps) {
  const a = accentCls[accent]
  const base =
    'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 focus:outline-none focus:ring-2 ' +
    a.ring
  const size = small ? 'px-2.5 py-1.5 text-xs' : 'px-4 py-2 text-sm'
  const v =
    variant === 'solid'
      ? `${a.bg} text-white shadow-sm hover:shadow`
      : variant === 'danger'
        ? 'bg-red-600 hover:bg-red-700 text-white shadow-sm'
        : variant === 'outline'
          ? 'border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-slate-700 shadow-sm'
          : 'hover:bg-slate-100 text-slate-600 hover:text-slate-900'
  return (
    <button className={cx(base, size, v, className)} disabled={disabled || loading} {...p}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  )
}

export function Input(p: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  const { label, className, ...rest } = p
  return (
    <label className="block text-sm">
      {label && <span className="mb-1.5 block text-xs font-semibold tracking-wide text-slate-600">{label}</span>}
      <input
        className={cx(
          'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm shadow-sm transition-all placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20',
          className,
        )}
        {...rest}
      />
    </label>
  )
}

export function Select({ label, children, className, ...p }: React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return (
    <label className="block text-sm">
      {label && <span className="mb-1.5 block text-xs font-semibold tracking-wide text-slate-600">{label}</span>}
      <select
        className={cx(
          'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm shadow-sm transition-all focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20',
          className,
        )}
        {...p}
      >
        {children}
      </select>
    </label>
  )
}

export function Card({
  children,
  className,
  title,
  action,
  icon,
  noPad,
}: {
  children: ReactNode
  className?: string
  title?: ReactNode
  action?: ReactNode
  icon?: ReactNode
  noPad?: boolean
}) {
  return (
    <section className={cx('rounded-2xl border border-slate-200/80 bg-white shadow-sm transition-shadow duration-200', className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-2">
            {icon && <span className="shrink-0 text-slate-400">{icon}</span>}
            <h3 className="truncate text-sm font-semibold text-slate-800">{title}</h3>
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={noPad ? '' : 'p-5'}>{children}</div>
    </section>
  )
}

const badgeColors: Record<string, { cls: string; dot?: string }> = {
  READY: { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  PARSED: { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  SUCCEEDED: { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  COMPLETED: { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  DONE: { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  PROCESSING: { cls: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500 animate-pulse-dot' },
  INDEXING: { cls: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500 animate-pulse-dot' },
  RUNNING: { cls: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500 animate-pulse-dot' },
  GENERATING: { cls: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500 animate-pulse-dot' },
  IN_PROGRESS: { cls: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500 animate-pulse-dot' },
  QUEUED: { cls: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400 animate-pulse-dot' },
  UPLOADED: { cls: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400' },
  PENDING: { cls: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400 animate-pulse-dot' },
  FAILED: { cls: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500' },
  ERROR: { cls: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500' },
}

export function Badge({ children, tone }: { children: ReactNode; tone?: string }) {
  const key = String(children)
  const preset = badgeColors[key]
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide',
        tone ? `${tone} border-transparent` : preset?.cls ?? 'border-slate-200 bg-slate-100 text-slate-600',
      )}
    >
      {!tone && preset?.dot && <span className={cx('h-1.5 w-1.5 rounded-full', preset.dot)} />}
      {children}
    </span>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2.5 py-8 text-sm text-slate-500">
      <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
      <span>{label ?? 'Loading…'}</span>
    </div>
  )
}

export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  const msg = error instanceof Error ? error.message : String(error ?? 'Something went wrong')
  return (
    <div className="animate-fade-in flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-800" role="alert">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
      <div className="flex-1 leading-relaxed">{msg}</div>
      {retry && (
        <button onClick={retry} className="shrink-0 rounded-lg px-2 py-0.5 text-xs font-semibold underline hover:bg-red-100/60">
          Retry
        </button>
      )}
    </div>
  )
}

export function EmptyState({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="animate-fade-in flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
      {icon && (
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 shadow-inner">
          {icon}
        </div>
      )}
      <div className="text-base font-semibold text-slate-800">{title}</div>
      {hint && <div className="mt-1.5 max-w-md text-sm leading-relaxed text-slate-500">{hint}</div>}
      {action && <div className="mt-5">{action}</div>}
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={cx(
          'animate-scale-in max-h-[90vh] w-full overflow-auto rounded-2xl border border-slate-200 bg-white shadow-2xl',
          wide ? 'max-w-3xl' : 'max-w-lg',
        )}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}

export function Drawer({ open, onClose, title, children, width = 'max-w-xl' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: string }) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/40 backdrop-blur-[2px]" onMouseDown={onClose}>
      <aside
        className={cx('animate-slide-in-right flex h-full w-full flex-col border-l border-slate-200 bg-white shadow-2xl', width)}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <div className="min-w-0 truncate text-sm font-semibold text-slate-900">{title}</div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </aside>
    </div>
  )
}

export function ProgressBar({ pct, accent = 'indigo' }: { pct: number; accent?: Accent }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className={cx('h-full rounded-full transition-all duration-500 ease-out', accentCls[accent].bar)}
        style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
      />
    </div>
  )
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

export function ScoreGauge({ value, label, size = 100 }: { value: number | null | undefined; label: string; size?: number }) {
  const v = value ?? 0
  const r = size / 2 - 9
  const c = 2 * Math.PI * r
  const color = value == null ? '#94a3b8' : v >= 75 ? '#10b981' : v >= 50 ? '#f59e0b' : '#ef4444'
  return (
    <div className="flex flex-col items-center">
      <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
        <svg width={size} height={size} role="img" aria-label={`${label}: ${value ?? 'n/a'}`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" className="stroke-slate-200 dark:stroke-zinc-800" strokeWidth="8" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - v / 100)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.16, 1, 0.3, 1)' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold tracking-tight text-slate-900">{value == null ? '–' : Math.round(v)}</span>
          {value != null && <span className="text-[10px] font-medium text-slate-400">/ 100</span>}
        </div>
      </div>
      <div className="mt-1.5 text-center text-xs font-medium text-slate-500">{label}</div>
    </div>
  )
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
export function fmtDate(s?: string) { return s ? new Date(s).toLocaleString() : '' }
