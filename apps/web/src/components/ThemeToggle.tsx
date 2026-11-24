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
      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 ${className}`}
      aria-label={`Theme: ${labels[t]}. Switch to ${labels[next]}`}
      title={`Theme: ${labels[t]} (click for ${labels[next]})`}
    >
      <Icon className="h-4 w-4" />
      <span className="hidden sm:inline">{labels[t]}</span>
    </button>
  )
}
