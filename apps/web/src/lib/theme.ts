export type Theme = 'light' | 'dark' | 'system'
const KEY = 'campusai-theme'

export function getTheme(): Theme {
  const v = localStorage.getItem(KEY)
  return v === 'light' || v === 'dark' ? v : 'system'
}

export function isDark(t: Theme = getTheme()): boolean {
  return t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
}

export function applyTheme(t: Theme = getTheme()) {
  document.documentElement.classList.toggle('dark', isDark(t))
  document.documentElement.style.colorScheme = isDark(t) ? 'dark' : 'light'
}

export function setTheme(t: Theme) {
  if (t === 'system') localStorage.removeItem(KEY)
  else localStorage.setItem(KEY, t)
  applyTheme(t)
}

/** Keep "system" mode in sync with the OS setting. */
export function watchSystemTheme() {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const h = () => getTheme() === 'system' && applyTheme('system')
  mq.addEventListener('change', h)
  return () => mq.removeEventListener('change', h)
}
