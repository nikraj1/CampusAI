import { ReactNode, useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { bootstrapSession, useAuth } from './lib/api'
import { AppShell } from './components/AppShell'
import { Spinner } from './components/ui'
import { AuthPage } from './pages/auth'
import { Dashboard, Landing, SettingsPage, UnifiedChat } from './pages/misc'
import { StudyLayout } from './pages/study'
import { CareerLayout } from './pages/career'
import { ProjectsLayout } from './pages/projects'

const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 5000 } } })

function Protected({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth()
  const loc = useLocation()
  if (!ready) return <Spinner label="Restoring your session…" />
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />
  return <>{children}</>
}

export default function App() {
  useEffect(() => { bootstrapSession() }, [])
  return (
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
            <Route path="study/*" element={<StudyLayout />} />
            <Route path="career/*" element={<CareerLayout />} />
            <Route path="projects/*" element={<ProjectsLayout />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
