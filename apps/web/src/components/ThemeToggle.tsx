import { useEffect, useState } from 'react'
import { Moon, Sun, Monitor } from 'lucide-react'
import { Theme, getTheme, setTheme, watchSystemTheme } from '../lib/theme'

const order: Theme[] = ['light', 'dark', 'system']
const labels: Record<Theme, string> = { light: 'Light', dark: 'Dark', system: 'System' }

/** Cycles light → dark → system. The choice is persisted in localStorage. */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const [t, setT] = useState<Theme>(getTheme())
  useEffect(() => watchSystemTheme(), [])
  const Icon = t === 'light' ? Sun : t === 'dark' ? Moon : Monitor
  const next = order[(order.indexOf(t) + 1) % order.length]
  return (
    <button
      onClick={() => { setTheme(next); setT(next) }}
      className={`inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 active:scale-[0.98] ${className}`}
      aria-label={`Theme: ${labels[t]}. Switch to ${labels[next]}`}
      title={`Theme: ${labels[t]} (click for ${labels[next]})`}
    >
      <Icon className="h-3.5 w-3.5 text-indigo-500" />
      <span className="hidden sm:inline">{labels[t]}</span>
    </button>
  )
}
