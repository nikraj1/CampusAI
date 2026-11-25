import { useEffect, useMemo, useState } from 'react'
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  FolderGit2, Plus, RefreshCw, Trash2, File as FileIcon, Folder, ChevronRight,
  ChevronDown, FileCode2, ArrowLeft, Copy, Check, GitBranch, Search, Sparkles,
} from 'lucide-react'
import { api } from '../lib/api'
import { Citation } from '../lib/sse'
import { Badge, Button, Card, Drawer, EmptyState, ErrorBox, Input, Modal, ProgressBar, Spinner, cx, fmtDate, useJob } from '../components/ui'
import { ChatPanel } from '../components/ChatPanel'
import { Markdown } from '../components/Markdown'

export function ProjectsLayout() {
  return (
    <Routes>
      <Route index element={<ProjectsList />} />
      <Route path=":id" element={<ProjectWorkspace />} />
    </Routes>
  )
}

const langPalette = ['bg-amber-500', 'bg-indigo-500', 'bg-emerald-500', 'bg-sky-500', 'bg-rose-500']

function ProjectsList() {
  const qc = useQueryClient()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const list = useQuery({
    queryKey: ['repos'],
    queryFn: () => api.get('/projects/repositories'),
    refetchInterval: (q) => (((q.state.data as any[]) ?? []).some((r) => r.indexStatus === 'QUEUED' || r.indexStatus === 'INDEXING') ? 3000 : false),
  })
  const add = useMutation({ mutationFn: () => api.post('/projects/repositories', { url }), onSuccess: () => { setOpen(false); setUrl(''); qc.invalidateQueries({ queryKey: ['repos'] }) } })
  const del = useMutation({ mutationFn: (id: string) => api.del(`/projects/repositories/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['repos'] }) })
  const items: any[] = (list.data as any[]) ?? []

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Project AI</h1>
          <p className="text-sm text-slate-500">Index any public GitHub repository to explore code, debug stack traces, and generate documentation.</p>
        </div>
        <Button accent="amber" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Add repository</Button>
      </div>

      {list.isLoading ? <Spinner /> : items.length === 0 ? (
        <EmptyState
          icon={<FolderGit2 className="h-7 w-7 text-amber-500" />}
          title="No repositories yet"
          hint="Paste a public GitHub URL such as https://github.com/spring-projects/spring-petclinic to index symbols, imports, and code chunks."
          action={<Button accent="amber" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Add your first repository</Button>}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {items.map((r) => {
            const langs = Object.entries(r.languages ?? {}).slice(0, 5) as [string, number][]
            return (
              <Card key={r.id} className="group transition-all hover:-translate-y-0.5 hover:border-amber-300 hover:shadow">
                <div className="flex items-start justify-between gap-2">
                  <button className="min-w-0 flex-1 text-left" onClick={() => nav(`/app/projects/${r.id}`)}>
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                        <FolderGit2 className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-slate-900 group-hover:text-amber-700">{r.fullName}</div>
                        <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                          {r.branch && <span className="inline-flex items-center gap-1"><GitBranch className="h-3 w-3" />{r.branch}</span>}
                          <span>{r.fileCount} files · {r.chunkCount} chunks</span>
                        </div>
                      </div>
                    </div>
                  </button>
                  <Badge>{r.indexStatus}</Badge>
                </div>

                {r.indexStatus === 'FAILED' && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{r.errorMessage}</div>}
                {(r.indexStatus === 'QUEUED' || r.indexStatus === 'INDEXING') && (
                  <div className="mt-3.5">
                    <ProgressBar pct={25} accent="amber" />
                    <div className="mt-1 text-xs text-slate-500">Indexing repository in the background…</div>
                  </div>
                )}

                {langs.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      {langs.map(([k, v], idx) => (
                        <div key={k} className={langPalette[idx % langPalette.length]} style={{ width: `${Math.max(4, Math.round(v * 100))}%` }} title={`${k} ${Math.round(v * 100)}%`} />
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {langs.slice(0, 4).map(([k, v], idx) => (
                        <span key={k} className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-600">
                          <span className={cx('h-2 w-2 rounded-full', langPalette[idx % langPalette.length])} />
                          {k} {Math.round(v * 100)}%
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                  <button onClick={() => nav(`/app/projects/${r.id}`)} className="text-xs font-semibold text-amber-700 hover:underline">Open workspace →</button>
                  <button aria-label="Delete repository" className="rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600" onClick={() => confirm(`Delete ${r.fullName} and its index?`) && del.mutate(r.id)}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Add a GitHub repository">
        <div className="space-y-4">
          <Input label="Repository URL" placeholder="https://github.com/owner/repo" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus />
          <p className="text-xs leading-relaxed text-slate-500">
            Public repositories only. Append <code className="rounded bg-slate-100 px-1 py-0.5 font-mono">/tree/branch</code> to index a specific branch. Up to 3,000 source files are indexed (build outputs &amp; dependencies are skipped).
          </p>
          {add.error && <ErrorBox error={add.error} />}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button accent="amber" loading={add.isPending} disabled={!url.trim()} onClick={() => add.mutate()}>Add &amp; index</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

interface TreeNode { name: string; path: string; children: Map<string, TreeNode>; file?: any }
function buildTree(files: any[]): TreeNode {
  const root: TreeNode = { name: '', path: '', children: new Map() }
  for (const f of files) {
    let cur = root
    const parts = f.path.split('/')
    parts.forEach((p: string, i: number) => {
      if (!cur.children.has(p)) cur.children.set(p, { name: p, path: parts.slice(0, i + 1).join('/'), children: new Map() })
      cur = cur.children.get(p)!
      if (i === parts.length - 1) cur.file = f
    })
  }
  return root
}

function TreeView({ node, depth, onOpen, selected, forceOpen }: { node: TreeNode; depth: number; onOpen: (p: string) => void; selected?: string; forceOpen?: boolean }) {
  const [open, setOpen] = useState(depth < 1)
  const isOpen = forceOpen || open
  const kids = [...node.children.values()].sort((a, b) => Number(!!a.file && !a.children.size) - Number(!!b.file && !b.children.size) || a.name.localeCompare(b.name))
  if (node.file && node.children.size === 0) {
    return (
      <button
        onClick={() => onOpen(node.path)}
        className={cx(
          'flex w-full items-center gap-1.5 truncate rounded-lg px-2 py-1 text-left text-xs transition hover:bg-slate-100',
          selected === node.path && 'bg-amber-50 font-semibold text-amber-800',
        )}
        style={{ paddingLeft: depth * 12 + 6 }}
      >
        <FileIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <span className="truncate">{node.name}</span>
      </button>
    )
  }
  return (
    <div>
      {depth > 0 && (
        <button
          onClick={() => setOpen(!open)}
          className="flex w-full items-center gap-1 rounded-lg px-2 py-1 text-left text-xs font-medium text-slate-700 transition hover:bg-slate-100"
          style={{ paddingLeft: depth * 12 - 6 }}
        >
          {isOpen ? <ChevronDown className="h-3 w-3 shrink-0 text-slate-400" /> : <ChevronRight className="h-3 w-3 shrink-0 text-slate-400" />}
          <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          <span className="truncate">{node.name}</span>
        </button>
      )}
      {(isOpen || depth === 0) && kids.map((k) => <TreeView key={k.path} node={k} depth={depth + 1} onOpen={onOpen} selected={selected} forceOpen={forceOpen} />)}
    </div>
  )
}

export function CodeViewer({ repoId, path, start, end, onClose }: { repoId: string; path: string | null; start?: number; end?: number; onClose: () => void }) {
  const q = useQuery({ queryKey: ['file', repoId, path], enabled: !!path, queryFn: () => api.get(`/projects/repositories/${repoId}/file?path=${encodeURIComponent(path!)}`) })
  const [copied, setCopied] = useState(false)
  useEffect(() => { if (q.data && start) document.getElementById(`L${start}`)?.scrollIntoView({ block: 'center' }) }, [q.data, start])
  const content: string = q.data ? (q.data as any).content : ''
  const lines: string[] = content ? content.split('\n') : []
  function copyFile() {
    navigator.clipboard?.writeText(content).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600) }).catch(() => undefined)
  }
  return (
    <Drawer
      open={!!path}
      onClose={onClose}
      width="max-w-3xl"
      title={
        <div className="flex items-center gap-2">
          <FileCode2 className="h-4 w-4 shrink-0 text-amber-500" />
          <span className="truncate font-mono text-xs">{path}{start ? `:${start}${end && end !== start ? `-${end}` : ''}` : ''}</span>
          {q.data && (
            <button onClick={copyFile} className="ml-2 inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100">
              {copied ? <><Check className="h-3 w-3 text-emerald-500" />Copied</> : <><Copy className="h-3 w-3" />Copy</>}
            </button>
          )}
        </div>
      }
    >
      {q.isLoading && <Spinner label="Loading file…" />}
      {q.error && <div className="p-4"><ErrorBox error={q.error} /></div>}
      {q.data && (
        <pre className="overflow-auto bg-slate-950 p-0 font-mono text-[12px] leading-6 text-slate-200">
          <code>
            {lines.map((l, i) => {
              const n = i + 1
              const hl = !!start && n >= start && n <= (end ?? start)
              return (
                <div key={i} id={`L${n}`} className={cx('flex px-2', hl && 'bg-amber-500/20 border-l-2 border-amber-400')}>
                  <span className="w-12 shrink-0 select-none pr-4 text-right text-slate-500">{n}</span>
                  <span className="whitespace-pre">{l}</span>
                </div>
              )
            })}
          </code>
        </pre>
      )}
    </Drawer>
  )
}

function ProjectWorkspace() {
  const { id } = useParams()
  const [sp] = useSearchParams()
  const qc = useQueryClient()
  const repo = useQuery({
    queryKey: ['repo', id],
    queryFn: () => api.get(`/projects/repositories/${id}`),
    refetchInterval: (q) => (['QUEUED', 'INDEXING'].includes((q.state.data as any)?.indexStatus) ? 2500 : false),
  })
  const r = repo.data as any
  const tree = useQuery({ queryKey: ['tree', id, r?.indexStatus], enabled: r?.indexStatus === 'READY', queryFn: () => api.get(`/projects/repositories/${id}/tree`) })
  const [file, setFile] = useState<{ path: string; start?: number; end?: number } | null>(null)
  const [tab, setTab] = useState<'chat' | 'overview' | 'docs'>('chat')
  const [fileFilter, setFileFilter] = useState('')
  const [copiedDoc, setCopiedDoc] = useState(false)

  const filteredFiles = useMemo(() => {
    const all = (tree.data as any[]) ?? []
    if (!fileFilter.trim()) return all
    const q = fileFilter.toLowerCase()
    return all.filter((f) => f.path.toLowerCase().includes(q))
  }, [tree.data, fileFilter])
  const root = useMemo(() => buildTree(filteredFiles), [filteredFiles])

  const reindex = useMutation({ mutationFn: () => api.post(`/projects/repositories/${id}/reindex`), onSuccess: () => qc.invalidateQueries({ queryKey: ['repo', id] }) })
  const [docType, setDocType] = useState('README')
  const [jobId, setJobId] = useState<string | null>(null)
  const job = useJob(jobId)
  const gen = useMutation({ mutationFn: () => api.post(`/projects/repositories/${id}/docs`, { type: docType }), onSuccess: (x: any) => setJobId(x.jobId) })
  const j = job.data as any
  if (repo.isLoading) return <Spinner />
  if (repo.error) return <div className="p-6"><ErrorBox error={repo.error} /></div>
  const onCitation = (c: Citation) => c.path && setFile({ path: c.path, start: c.startLine, end: c.endLine })
  const ready = r.indexStatus === 'READY'

  function copyMarkdown(md: string) {
    navigator.clipboard?.writeText(md).then(() => { setCopiedDoc(true); setTimeout(() => setCopiedDoc(false), 1800) }).catch(() => undefined)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 bg-white px-5 py-2.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <Link to="/app/projects" className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 hover:underline"><ArrowLeft className="h-3.5 w-3.5" />Projects</Link>
          <span className="font-bold text-slate-900">{r.fullName}</span>
          <Badge>{r.indexStatus}</Badge>
          {r.branch && <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600"><GitBranch className="h-3 w-3" />{r.branch}</span>}
        </div>
        <div className="flex items-center gap-1.5">
          {(['chat', 'overview', 'docs'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cx('rounded-xl px-3 py-1.5 text-xs font-semibold capitalize transition', tab === t ? 'bg-amber-50 text-amber-800 shadow-sm' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800')}
            >
              {t === 'docs' ? 'Generate docs' : t}
            </button>
          ))}
          <Button small variant="outline" loading={reindex.isPending} onClick={() => reindex.mutate()} disabled={!ready && r.indexStatus !== 'FAILED'} aria-label="Re-index">
            <RefreshCw className="h-3.5 w-3.5" />Re-index
          </Button>
        </div>
      </div>

      {(r.indexStatus === 'QUEUED' || r.indexStatus === 'INDEXING') && (
        <div className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-800">
          <div className="mb-1.5 font-medium">Indexing: {r.latestJob?.stage ?? 'queued'}…</div>
          <ProgressBar pct={r.latestJob?.progress ?? 5} accent="amber" />
        </div>
      )}
      {r.indexStatus === 'FAILED' && <div className="p-4"><ErrorBox error={r.errorMessage ?? 'Indexing failed'} /></div>}

      {ready && (
        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-72 shrink-0 flex-col border-r border-slate-200/80 bg-white md:flex" aria-label="File tree">
            <div className="border-b border-slate-100 p-2.5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                <input
                  value={fileFilter}
                  onChange={(e) => setFileFilter(e.target.value)}
                  placeholder="Filter files…"
                  aria-label="Filter repository files"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-2.5 text-xs focus:border-amber-400 focus:bg-white focus:outline-none"
                />
              </div>
            </div>
            <div className="flex-1 overflow-auto p-2">
              <TreeView node={root} depth={0} onOpen={(p) => setFile({ path: p })} selected={file?.path} forceOpen={!!fileFilter.trim()} />
            </div>
          </aside>

          <div className="min-w-0 flex-1 overflow-auto">
            {tab === 'chat' && (
              <div className="h-full">
                <ChatPanel
                  key={sp.get('c') ?? id}
                  module="PROJECT"
                  accent="amber"
                  scope={{ repositoryId: id }}
                  conversationId={sp.get('c')}
                  onCitation={onCitation}
                  placeholder={`Ask about ${r.fullName}: where something is implemented, how components interact, or paste a stack trace to find the root cause.`}
                  suggestions={[
                    'Give me an architecture overview of this project',
                    'Where is the main entry point and how does the app start?',
                    'Which technologies and dependencies does this project use?',
                    'Walk me through the core request or data flow with file citations',
                  ]}
                />
              </div>
            )}
            {tab === 'overview' && (
              <div className="mx-auto max-w-3xl space-y-5 p-6">
                <Card title="Repository summary"><Markdown>{r.summary ?? 'No summary available.'}</Markdown></Card>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Card title="Detected stack">
                    <dl className="space-y-2 text-sm">
                      {[['Frameworks', r.detectedStack?.frameworks], ['Build tools', r.detectedStack?.buildTools], ['Databases', r.detectedStack?.databases]].map(([k, v]: any) => (
                        <div key={k} className="rounded-xl bg-slate-50 px-3 py-2">
                          <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{k}</dt>
                          <dd className="mt-0.5 font-medium text-slate-800">{v?.length ? v.join(', ') : 'None detected'}</dd>
                        </div>
                      ))}
                    </dl>
                  </Card>
                  <Card title="Languages">
                    <ul className="space-y-2.5 text-sm">
                      {Object.entries(r.languages ?? {}).map(([k, v], idx) => (
                        <li key={k}>
                          <div className="flex justify-between text-xs"><span className="font-medium text-slate-700">{k}</span><b className="text-slate-900">{Math.round((v as number) * 100)}%</b></div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={langPalette[idx % langPalette.length]} style={{ width: `${Math.round((v as number) * 100)}%`, height: '100%' }} /></div>
                        </li>
                      ))}
                    </ul>
                  </Card>
                </div>
                <Card title="Entry points & central files">
                  <ul className="space-y-1.5 text-sm">
                    {[...(r.detectedStack?.entryPoints ?? []), ...(r.detectedStack?.centralFiles ?? [])].filter((x: string, i: number, a: string[]) => a.indexOf(x) === i).map((p: string) => (
                      <li key={p}>
                        <button className="flex items-center gap-2 rounded-lg px-2 py-1 font-mono text-xs font-medium text-amber-800 transition hover:bg-amber-50" onClick={() => setFile({ path: p })}>
                          <FileCode2 className="h-3.5 w-3.5" />{p}
                        </button>
                      </li>
                    ))}
                  </ul>
                </Card>
                <p className="text-xs text-slate-500">Indexed {fmtDate(r.indexedAt)} · commit <span className="font-mono">{r.lastIndexedCommit?.slice(0, 8)}</span> · {r.fileCount} files · {r.chunkCount} chunks</p>
              </div>
            )}
            {tab === 'docs' && (
              <div className="mx-auto max-w-3xl space-y-5 p-6">
                <Card title="Generate documentation" icon={<Sparkles className="h-4 w-4 text-amber-500" />}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap gap-2">
                      {['README', 'API', 'ARCHITECTURE'].map((t) => (
                        <button
                          key={t}
                          onClick={() => setDocType(t)}
                          className={cx(
                            'rounded-xl border px-3.5 py-2 text-xs font-semibold transition',
                            docType === t ? 'border-amber-500 bg-amber-50 text-amber-800 shadow-sm' : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                          )}
                        >
                          {t}.md
                        </button>
                      ))}
                    </div>
                    <Button accent="amber" loading={gen.isPending || (!!jobId && j?.status !== 'SUCCEEDED' && j?.status !== 'FAILED')} onClick={() => { setJobId(null); gen.mutate() }}>
                      <Sparkles className="h-4 w-4" />Generate
                    </Button>
                  </div>
                  {gen.error && <div className="mt-3"><ErrorBox error={gen.error} /></div>}
                  {j?.status === 'FAILED' && <div className="mt-3"><ErrorBox error={j.errorMessage} /></div>}
                </Card>
                {j?.status === 'SUCCEEDED' && (
                  <Card
                    title={`${j.result.type}.md`}
                    action={
                      <Button small variant="outline" onClick={() => copyMarkdown(j.result.markdown)}>
                        {copiedDoc ? <><Check className="h-3.5 w-3.5 text-emerald-500" />Copied</> : <><Copy className="h-3.5 w-3.5" />Copy markdown</>}
                      </Button>
                    }
                  >
                    <Markdown>{j.result.markdown}</Markdown>
                  </Card>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      <CodeViewer repoId={id!} path={file?.path ?? null} start={file?.start} end={file?.end} onClose={() => setFile(null)} />
    </div>
  )
}
