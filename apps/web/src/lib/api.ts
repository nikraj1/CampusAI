import { create } from 'zustand'

export interface User { id: string; email: string; fullName: string; role: string }

interface AuthState {
  user: User | null
  token: string | null
  ready: boolean
  set: (user: User | null, token: string | null) => void
  setReady: () => void
}

/** Access token lives in memory only (never localStorage); the refresh token is an HttpOnly cookie. */
export const useAuth = create<AuthState>((set) => ({
  user: null,
  token: null,
  ready: false,
  set: (user, token) => set({ user, token }),
  setReady: () => set({ ready: true }),
}))

export class ApiError extends Error {
  status: number
  code: string
  retryable: boolean
  constructor(status: number, code: string, message: string, retryable = false) {
    super(message)
    this.status = status
    this.code = code
    this.retryable = retryable
  }
}

function tokenExpiresInMs(token: string): number {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload.exp * 1000 - Date.now()
  } catch {
    return 0
  }
}

let refreshing: Promise<string | null> | null = null

export function refreshToken(): Promise<string | null> {
  if (!refreshing) {
    refreshing = fetch('/api/v1/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
      .then(async (r) => {
        if (!r.ok) return null
        const j = await r.json()
        useAuth.getState().set(j.user, j.accessToken)
        return j.accessToken as string
      })
      .catch(() => null)
      .finally(() => {
        refreshing = null
      })
  }
  return refreshing
}

export async function getToken(): Promise<string | null> {
  const { token } = useAuth.getState()
  if (token && tokenExpiresInMs(token) > 20_000) return token
  return refreshToken()
}

async function parseError(res: Response): Promise<ApiError> {
  let code = 'ERROR'
  let msg = res.statusText || 'Request failed'
  let retryable = false
  try {
    const j = await res.json()
    code = j.code ?? code
    msg = j.detail ?? j.message ?? msg
    retryable = !!j.retryable
  } catch { /* ignore */ }
  return new ApiError(res.status, code, msg, retryable)
}

async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const token = await getToken()
  const headers: Record<string, string> = {}
  let payload: BodyInit | undefined
  if (body instanceof FormData) payload = body
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch('/api/v1' + path, { method, headers, body: payload, credentials: 'include' })
  if (res.status === 401 && retry) {
    const t = await refreshToken()
    if (t) return request<T>(method, path, body, false)
    useAuth.getState().set(null, null)
  }
  if (!res.ok) throw await parseError(res)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  get: <T = any>(p: string) => request<T>('GET', p),
  post: <T = any>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  put: <T = any>(p: string, b?: unknown) => request<T>('PUT', p, b),
  patch: <T = any>(p: string, b?: unknown) => request<T>('PATCH', p, b),
  del: <T = any>(p: string, b?: unknown) => request<T>('DELETE', p, b),
  upload: <T = any>(p: string, form: FormData) => request<T>('POST', p, form),
  async blobUrl(p: string): Promise<string> {
    const token = await getToken()
    const res = await fetch('/api/v1' + p, { headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: 'include' })
    if (!res.ok) throw await parseError(res)
    return URL.createObjectURL(await res.blob())
  },
}

export async function bootstrapSession() {
  await refreshToken()
  useAuth.getState().setReady()
}

export async function logout() {
  try {
    await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
  } finally {
    useAuth.getState().set(null, null)
  }
}

export async function authCall(path: 'login' | 'register', body: unknown) {
  const res = await fetch('/api/v1/auth/' + path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw await parseError(res)
  const j = await res.json()
  useAuth.getState().set(j.user, j.accessToken)
}
