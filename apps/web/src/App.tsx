import { ReactNode, Suspense, lazy, useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { bootstrapSession, useAuth } from './lib/api'
import { AppShell } from './components/AppShell'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Spinner } from './components/ui'
import { AuthPage } from './pages/auth'
import { Dashboard, Landing, SettingsPage, UnifiedChat } from './pages/misc'

const StudyLayout = lazy(() => import('./pages/study').then((m) => ({ default: m.StudyLayout })))
const CareerLayout = lazy(() => import('./pages/career').then((m) => ({ default: m.CareerLayout })))
const ProjectsLayout = lazy(() => import('./pages/projects').then((m) => ({ default: m.ProjectsLayout })))

const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 5000 } } })

function Protected({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth()
  const loc = useLocation()
  if (!ready) return <Spinner label="Restoring your session…" />
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />
  return <>{children}</>
}

function LazyWrap({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Spinner label="Loading workspace…" />}>{children}</Suspense>
}

export default function App() {
  useEffect(() => { bootstrapSession() }, [])
  return (
    <ErrorBoundary>
      <QueryClientProvider client={qc}>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<AuthPage mode="login" />} />
            <Route path="/register" element={<AuthPage mode="register" />} />
            <Route path="/app" element={<Protected><AppShell /></Protected>}>
              <Route index element={<Dashboard />} />
              <Route path="chat" element={<UnifiedChat />} />
              <Route path="chat/:id" element={<UnifiedChat />} />
              <Route path="study/*" element={<LazyWrap><StudyLayout /></LazyWrap>} />
              <Route path="career/*" element={<LazyWrap><CareerLayout /></LazyWrap>} />
              <Route path="projects/*" element={<LazyWrap><ProjectsLayout /></LazyWrap>} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
