import { useEffect, useMemo, useState } from 'react'
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderGit2, Plus, RefreshCw, Trash2, File as FileIcon, Folder, ChevronRight, ChevronDown, FileCode2 } from 'lucide-react'
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

function ProjectsList() {
  const qc = useQueryClient()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const list = useQuery({ queryKey: ['repos'], queryFn: () => api.get('/projects/repositories'), refetchInterval: (q) => (((q.state.data as any[]) ?? []).some((r) => r.indexStatus === 'QUEUED' || r.indexStatus === 'INDEXING') ? 3000 : false) })
  const add = useMutation({ mutationFn: () => api.post('/projects/repositories', { url }), onSuccess: () => { setOpen(false); setUrl(''); qc.invalidateQueries({ queryKey: ['repos'] }) } })
  const del = useMutation({ mutationFn: (id: string) => api.del(`/projects/repositories/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['repos'] }) })
  const items: any[] = (list.data as any[]) ?? []
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <div className="flex items-center justify-between"><div><h1 className="text-xl font-bold">Project AI</h1><p className="text-sm text-slate-500">Index a public GitHub repository, then ask questions, debug errors and generate docs.</p></div><Button accent="amber" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Add repository</Button></div>
      {list.isLoading ? <Spinner /> : items.length === 0 ? <EmptyState icon={<FolderGit2 className="h-8 w-8" />} title="No repositories yet" hint="Paste a GitHub URL such as https://github.com/spring-projects/spring-petclinic. Repositories up to ~100 MB are supported; private repositories are not supported in this version." action={<Button accent="amber" onClick={() => setOpen(true)}>Add your first repository</Button>} /> : (
        <div className="grid gap-4 md:grid-cols-2">{items.map((r) => (
          <Card key={r.id}>
            <div className="flex items-start justify-between"><button className="text-left" onClick={() => nav(`/app/projects/${r.id}`)}><div className="flex items-center gap-2 font-semibold hover:underline"><FolderGit2 className="h-4 w-4 text-amber-600" />{r.fullName}</div><div className="mt-1 text-xs text-slate-500">{r.branch ? `branch ${r.branch} · ` : ''}{r.fileCount} files · {r.chunkCount} chunks</div></button><Badge>{r.indexStatus}</Badge></div>
            {r.indexStatus === 'FAILED' && <div className="mt-2 text-xs text-red-600">{r.errorMessage}</div>}
            {(r.indexStatus === 'QUEUED' || r.indexStatus === 'INDEXING') && <div className="mt-3"><ProgressBar pct={20} /><div className="mt-1 text-xs text-slate-500">Indexing in the background…</div></div>}
            {r.languages && Object.keys(r.languages).length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{Object.entries(r.languages).slice(0, 4).map(([k, v]) => <span key={k} className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">{k} {Math.round((v as number) * 100)}%</span>)}</div>}
            <div className="mt-3 flex justify-end"><button aria-label="Delete repository" className="p-1 text-slate-400 hover:text-red-600" onClick={() => confirm(`Delete ${r.fullName} and its index?`) && del.mutate(r.id)}><Trash2 className="h-4 w-4" /></button></div>
          </Card>))}</div>)}
      <Modal open={open} onClose={() => setOpen(false)} title="Add a GitHub repository">
        <div className="space-y-3"><Input label="Repository URL" placeholder="https://github.com/owner/repo" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus />
          <p className="text-xs text-slate-500">Public repositories only. Add <code>/tree/branch</code> to index a specific branch. At most 3,000 source files are indexed (build output and dependencies are skipped).</p>
          {add.error && <ErrorBox error={add.error} />}<div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button accent="amber" loading={add.isPending} disabled={!url.trim()} onClick={() => add.mutate()}>Add & index</Button></div></div>
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

function TreeView({ node, depth, onOpen, selected }: { node: TreeNode; depth: number; onOpen: (p: string) => void; selected?: string }) {
  const [open, setOpen] = useState(depth < 1)
  const kids = [...node.children.values()].sort((a, b) => Number(!!a.file && !a.children.size) - Number(!!b.file && !b.children.size) || a.name.localeCompare(b.name))
  if (node.file && node.children.size === 0) {
    return <button onClick={() => onOpen(node.path)} className={cx('flex w-full items-center gap-1.5 truncate rounded px-1 py-0.5 text-left text-xs hover:bg-slate-100', selected === node.path && 'bg-amber-50 font-medium')} style={{ paddingLeft: depth * 12 + 4 }}><FileIcon className="h-3 w-3 shrink-0 text-slate-400" />{node.name}</button>
  }
  return (
    <div>
      {depth > 0 && <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-xs font-medium hover:bg-slate-100" style={{ paddingLeft: depth * 12 - 8 }}>{open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}<Folder className="h-3 w-3 text-amber-500" />{node.name}</button>}
      {(open || depth === 0) && kids.map((k) => <TreeView key={k.path} node={k} depth={depth + 1} onOpen={onOpen} selected={selected} />)}
    </div>
  )
}

export function CodeViewer({ repoId, path, start, end, onClose }: { repoId: string; path: string | null; start?: number; end?: number; onClose: () => void }) {
  const q = useQuery({ queryKey: ['file', repoId, path], enabled: !!path, queryFn: () => api.get(`/projects/repositories/${repoId}/file?path=${encodeURIComponent(path!)}`) })
  useEffect(() => { if (q.data && start) document.getElementById(`L${start}`)?.scrollIntoView({ block: 'center' }) }, [q.data, start])
  const lines: string[] = q.data ? (q.data as any).content.split('\n') : []
  return (
    <Drawer open={!!path} onClose={onClose} width="max-w-3xl" title={<span className="font-mono text-sm">{path}{start ? `:${start}${end && end !== start ? `-${end}` : ''}` : ''}</span>}>
      {q.isLoading && <Spinner />}{q.error && <div className="p-4"><ErrorBox error={q.error} /></div>}
      {q.data && <pre className="overflow-auto p-0 text-[12px] leading-5"><code>{lines.map((l, i) => { const n = i + 1; const hl = !!start && n >= start && n <= (end ?? start); return <div key={i} id={`L${n}`} className={cx('flex', hl && 'bg-amber-100')}><span className="w-12 shrink-0 select-none pr-3 text-right text-slate-400">{n}</span><span className="whitespace-pre">{l}</span></div> })}</code></pre>}
    </Drawer>
  )
}

function ProjectWorkspace() {
  const { id } = useParams()
  const [sp] = useSearchParams()
  const qc = useQueryClient()
  const repo = useQuery({ queryKey: ['repo', id], queryFn: () => api.get(`/projects/repositories/${id}`), refetchInterval: (q) => (['QUEUED', 'INDEXING'].includes((q.state.data as any)?.indexStatus) ? 2500 : false) })
  const r = repo.data as any
  const tree = useQuery({ queryKey: ['tree', id, r?.indexStatus], enabled: r?.indexStatus === 'READY', queryFn: () => api.get(`/projects/repositories/${id}/tree`) })
  const [file, setFile] = useState<{ path: string; start?: number; end?: number } | null>(null)
  const [tab, setTab] = useState<'chat' | 'overview' | 'docs'>('chat')
  const root = useMemo(() => buildTree(((tree.data as any[]) ?? [])), [tree.data])
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
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
        <div className="flex items-center gap-3"><Link to="/app/projects" className="text-xs text-amber-700">← Projects</Link><span className="font-semibold">{r.fullName}</span><Badge>{r.indexStatus}</Badge>{r.branch && <span className="text-xs text-slate-500">{r.branch}</span>}</div>
        <div className="flex items-center gap-1">{(['chat', 'overview', 'docs'] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={cx('rounded-lg px-3 py-1.5 text-sm font-medium capitalize', tab === t ? 'bg-amber-50 text-amber-800' : 'text-slate-500 hover:bg-slate-50')}>{t === 'docs' ? 'Generate docs' : t}</button>)}
          <Button small variant="outline" loading={reindex.isPending} onClick={() => reindex.mutate()} disabled={!ready && r.indexStatus !== 'FAILED'} aria-label="Re-index"><RefreshCw className="h-3.5 w-3.5" />Re-index</Button></div>
      </div>
      {(r.indexStatus === 'QUEUED' || r.indexStatus === 'INDEXING') && <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"><div className="mb-1">Indexing: {r.latestJob?.stage ?? 'queued'}…</div><ProgressBar pct={r.latestJob?.progress ?? 3} /></div>}
      {r.indexStatus === 'FAILED' && <div className="p-4"><ErrorBox error={r.errorMessage ?? 'Indexing failed'} /></div>}
      {ready && (
        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-64 shrink-0 overflow-auto border-r border-slate-200 bg-white p-2 md:block" aria-label="File tree"><TreeView node={root} depth={0} onOpen={(p) => setFile({ path: p })} selected={file?.path} /></aside>
          <div className="min-w-0 flex-1 overflow-auto">
            {tab === 'chat' && <div className="h-full"><ChatPanel key={sp.get('c') ?? id} module="PROJECT" accent="amber" scope={{ repositoryId: id }} conversationId={sp.get('c')} onCitation={onCitation}
              placeholder={`Ask about ${r.fullName}: where something is implemented, how it works, or paste an error / stack trace to find the root cause.`}
              suggestions={['Give me an architecture overview of this project', 'Where is the main entry point and how does the app start?', 'Which technologies does this project use and why?']} /></div>}
            {tab === 'overview' && (
              <div className="mx-auto max-w-3xl space-y-4 p-6">
                <Card title="Summary"><Markdown>{r.summary ?? 'No summary available.'}</Markdown></Card>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Card title="Detected stack"><dl className="space-y-1 text-sm">{[['Frameworks', r.detectedStack?.frameworks], ['Build tools', r.detectedStack?.buildTools], ['Databases', r.detectedStack?.databases]].map(([k, v]: any) => <div key={k}><dt className="inline font-medium">{k}: </dt><dd className="inline text-slate-600">{v?.length ? v.join(', ') : 'none detected'}</dd></div>)}</dl></Card>
                  <Card title="Languages"><ul className="space-y-1 text-sm">{Object.entries(r.languages ?? {}).map(([k, v]) => <li key={k} className="flex justify-between"><span>{k}</span><b>{Math.round((v as number) * 100)}%</b></li>)}</ul></Card>
                </div>
                <Card title="Entry points & central files"><ul className="space-y-1 text-sm">{[...(r.detectedStack?.entryPoints ?? []), ...(r.detectedStack?.centralFiles ?? [])].filter((x: string, i: number, a: string[]) => a.indexOf(x) === i).map((p: string) => <li key={p}><button className="flex items-center gap-1.5 font-mono text-xs text-amber-800 hover:underline" onClick={() => setFile({ path: p })}><FileCode2 className="h-3.5 w-3.5" />{p}</button></li>)}</ul></Card>
                <p className="text-xs text-slate-500">Indexed {fmtDate(r.indexedAt)} · commit {r.lastIndexedCommit?.slice(0, 8)} · {r.fileCount} files · {r.chunkCount} chunks</p>
              </div>)}
            {tab === 'docs' && (
              <div className="mx-auto max-w-3xl space-y-4 p-6">
                <Card title="Generate documentation"><div className="flex flex-wrap items-end gap-3"><div className="flex gap-2">{['README', 'API', 'ARCHITECTURE'].map((t) => <button key={t} onClick={() => setDocType(t)} className={cx('rounded-lg border px-3 py-1.5 text-sm', docType === t ? 'border-amber-500 bg-amber-50 text-amber-800' : 'border-slate-200')}>{t}</button>)}</div>
                  <Button accent="amber" loading={gen.isPending || (!!jobId && j?.status !== 'SUCCEEDED' && j?.status !== 'FAILED')} onClick={() => { setJobId(null); gen.mutate() }}>Generate</Button></div>
                  {gen.error && <div className="mt-3"><ErrorBox error={gen.error} /></div>}{j?.status === 'FAILED' && <div className="mt-3"><ErrorBox error={j.errorMessage} /></div>}</Card>
                {j?.status === 'SUCCEEDED' && <Card title={`${j.result.type}.md`} action={<Button small variant="outline" onClick={() => navigator.clipboard.writeText(j.result.markdown)}>Copy markdown</Button>}><Markdown>{j.result.markdown}</Markdown></Card>}
              </div>)}
          </div>
        </div>)}
      <CodeViewer repoId={id!} path={file?.path ?? null} start={file?.start} end={file?.end} onClose={() => setFile(null)} />
    </div>
  )
}
