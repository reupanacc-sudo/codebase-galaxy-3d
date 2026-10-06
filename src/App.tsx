import React, { useMemo, useRef, useState } from 'react';
import {
  Orbit,
  Search,
  FolderOpen,
  RotateCcw,
  Sparkles,
  Tag,
  Play,
  Pause,
  Layers,
  Code2,
  GitBranch,
  FileCode2,
  X,
  ChevronLeft,
  ChevronRight,
  Sliders,
  Maximize2,
  ArrowUpRight,
  Flame,
  Zap,
  ShieldAlert,
  Activity,
  Globe,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Loader2,
} from 'lucide-react';
import { CLUSTER_META, GalaxyLink, GalaxyNode } from './data/galaxyTypes';
import { GalaxyCanvas3D, LayoutMode } from './components/GalaxyCanvas3D';
import { scanUploadedFiles } from './lib/folderScanner';
import {
  analyzeCodebaseHealth,
  ColorMode,
  traceFunctionCallChain,
} from './lib/codeHealth';
import {
  GitHubProgress,
  SAMPLE_GITHUB_REPOS,
  scanGitHubRepository,
} from './lib/githubScanner';

const KIND_LABELS: { id: GalaxyNode['kind']; label: string }[] = [
  { id: 'file', label: 'Files' },
  { id: 'function', label: 'Functions' },
  { id: 'state', label: 'State Hooks' },
  { id: 'hook', label: 'Memos / Sub-Hubs' },
  { id: 'interface', label: 'Interfaces' },
  { id: 'property', label: 'Props & Fields' },
  { id: 'database', label: 'DB Rules' },
];

export function App() {
  // Start in a 100% clean state with no preloaded private codebase
  const [projectName, setProjectName] = useState<string>('');
  const [nodes, setNodes] = useState<GalaxyNode[]>([]);
  const [links, setLinks] = useState<GalaxyLink[]>([]);

  const [selectedNode, setSelectedNode] = useState<GalaxyNode | null>(null);
  const [activeClusterFilter, setActiveClusterFilter] = useState<string | null>(null);
  const [activeKindFilter, setActiveKindFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [autoRotate, setAutoRotate] = useState<boolean>(true);
  const [showLabels, setShowLabels] = useState<boolean>(true);
  const [showParticles, setShowParticles] = useState<boolean>(true);
  const [showCallLinks, setShowCallLinks] = useState<boolean>(true);
  const [colorMode, setColorMode] = useState<ColorMode>('cluster');
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('galaxy');
  const [spreadFactor, setSpreadFactor] = useState<number>(1.0);
  const [dandelionRadius, setDandelionRadius] = useState<number>(1.0);
  const [resetCameraTrigger, setResetCameraTrigger] = useState<number>(0);
  const [leftPanelOpen, setLeftPanelOpen] = useState<boolean>(true);
  const [leftTab, setLeftTab] = useState<'clusters' | 'health'>('clusters');

  // Local folder & GitHub repo scanning states
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [isGitHubModalOpen, setIsGitHubModalOpen] = useState<boolean>(false);
  const [githubUrlInput, setGithubUrlInput] = useState<string>('');
  const [githubProgress, setGithubProgress] = useState<GitHubProgress | null>(null);
  const [githubError, setGithubError] = useState<string | null>(null);

  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const isEmptyState = nodes.length === 0;

  // 1. Compute Code Health Report & Circular Dependencies
  const healthReport = useMemo(
    () => analyzeCodebaseHealth(nodes, links),
    [nodes, links]
  );

  // 2. Compute Function Call Chain Trace for Selected Node
  const callChainTrace = useMemo(
    () => traceFunctionCallChain(selectedNode, nodes, links),
    [selectedNode, nodes, links]
  );

  // Cluster counts
  const clusterCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of nodes) {
      counts.set(n.clusterId, (counts.get(n.clusterId) || 0) + 1);
    }
    return counts;
  }, [nodes]);

  // Connected nodes for the currently selected node
  const selectedConnections = useMemo(() => {
    if (!selectedNode)
      return {
        parents: [] as GalaxyNode[],
        children: [] as GalaxyNode[],
        imports: [] as GalaxyNode[],
      };
    const nodeMap = new Map<string, GalaxyNode>();
    for (const n of nodes) nodeMap.set(n.id, n);

    const parents: GalaxyNode[] = [];
    const children: GalaxyNode[] = [];
    const imports: GalaxyNode[] = [];

    for (const l of links) {
      if (l.kind === 'call') continue;
      if (l.target === selectedNode.id) {
        const src = nodeMap.get(l.source);
        if (src) {
          if (l.kind === 'import' || l.kind === 'circular') imports.push(src);
          else parents.push(src);
        }
      } else if (l.source === selectedNode.id) {
        const tgt = nodeMap.get(l.target);
        if (tgt) {
          if (l.kind === 'import' || l.kind === 'circular') imports.push(tgt);
          else children.push(tgt);
        }
      }
    }
    return { parents, children, imports };
  }, [selectedNode, nodes, links]);

  const handleFolderUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIsScanning(true);
    try {
      const res = await scanUploadedFiles(files);
      setProjectName(res.projectName);
      setNodes(res.nodes);
      setLinks(res.links);
      setSelectedNode(null);
      setActiveClusterFilter(null);
      setActiveKindFilter(null);
      setResetCameraTrigger((c) => c + 1);
    } finally {
      setIsScanning(false);
    }
  };

  const handleGitHubScan = async (targetUrl?: string) => {
    const urlToScan = (targetUrl ?? githubUrlInput).trim();
    if (!urlToScan) return;
    setGithubError(null);
    setGithubProgress({ stage: 'Initializing GitHub scanner...', loaded: 0, total: 1 });
    try {
      const res = await scanGitHubRepository(urlToScan, (prog) => {
        setGithubProgress(prog);
      });
      setProjectName(res.projectName);
      setNodes(res.nodes);
      setLinks(res.links);
      setSelectedNode(null);
      setActiveClusterFilter(null);
      setActiveKindFilter(null);
      setIsGitHubModalOpen(false);
      setGithubProgress(null);
      setResetCameraTrigger((c) => c + 1);
    } catch (err: unknown) {
      setGithubError(err instanceof Error ? err.message : 'Failed to scan GitHub repository');
      setGithubProgress(null);
    }
  };

  const handleClearWorkspace = () => {
    setProjectName('');
    setNodes([]);
    setLinks([]);
    setSelectedNode(null);
    setActiveClusterFilter(null);
    setActiveKindFilter(null);
    setSearchQuery('');
    setGithubError(null);
    setResetCameraTrigger((c) => c + 1);
  };

  // Demo helper to inject or remove a simulated circular dependency
  const hasSimulatedCycle = links.some((l) => l.kind === 'circular');
  const handleToggleSimulatedCycle = () => {
    if (hasSimulatedCycle) {
      setLinks((prev) => prev.filter((l) => l.kind !== 'circular'));
    } else {
      const fileNodes = nodes.filter((n) => n.kind === 'file');
      if (fileNodes.length >= 2) {
        const a = fileNodes[0];
        const b = fileNodes[1];
        setLinks((prev) => [
          ...prev,
          { source: b.id, target: a.id, kind: 'circular', strength: 1.5 },
          { source: a.id, target: b.id, kind: 'circular', strength: 1.5 },
        ]);
        setColorMode('heatmap');
        setLeftTab('health');
        setSelectedNode(a);
      }
    }
  };

  const selectedMetric = selectedNode ? healthReport.nodeMetrics.get(selectedNode.id) : null;

  return (
    <div className="relative w-screen h-screen bg-[#02040a] text-slate-100 overflow-hidden font-sans">
      {/* 3D WebGL Galaxy Canvas (renders ambient starfield when empty, or full 3D galaxy when loaded) */}
      <GalaxyCanvas3D
        nodes={nodes}
        links={links}
        selectedNode={selectedNode}
        onSelectNode={setSelectedNode}
        activeClusterFilter={activeClusterFilter}
        activeKindFilter={activeKindFilter}
        searchQuery={searchQuery}
        autoRotate={autoRotate}
        showLabels={showLabels}
        showParticles={showParticles}
        showCallLinks={showCallLinks}
        colorMode={colorMode}
        healthReport={healthReport}
        callChainTrace={callChainTrace}
        spreadFactor={spreadFactor}
        dandelionRadius={dandelionRadius}
        layoutMode={layoutMode}
        resetCameraTrigger={resetCameraTrigger}
      />

      {/* Hidden Directory Input */}
      <input
        ref={folderInputRef}
        type="file"
        // @ts-expect-error webkitdirectory is standard in modern browsers
        webkitdirectory="true"
        directory="true"
        multiple
        className="hidden"
        onChange={handleFolderUpload}
      />

      {/* CLEAN EMPTY STATE LAUNCHPAD OVERLAY */}
      {isEmptyState && (
        <div className="absolute inset-0 z-30 flex items-center justify-center p-4 pointer-events-auto">
          <div className="w-full max-w-xl rounded-3xl border border-slate-800/90 bg-slate-950/90 p-7 shadow-2xl backdrop-blur-2xl space-y-6">
            {/* Hero Header */}
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 via-indigo-500 to-purple-600 shadow-xl shadow-sky-500/25">
                <Orbit className="h-8 w-8 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-extrabold tracking-tight text-white">
                  Codebase Galaxy <span className="text-sky-400">3D</span>
                </h1>
                <p className="text-xs text-slate-400 mt-0.5">
                  Interactive 3D Code Architecture, Call-Graph Tracer &amp; Complexity Heatmap
                </p>
              </div>
            </div>

            {/* Option 1: Paste Any Public GitHub URL */}
            <div className="rounded-2xl border border-slate-800/90 bg-slate-900/60 p-4 space-y-3">
              <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-sky-300">
                <Globe className="h-4 w-4 text-sky-400" />
                <span>Option 1: Visualize Any Public GitHub Repository</span>
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={githubUrlInput}
                  disabled={Boolean(githubProgress)}
                  onChange={(e) => setGithubUrlInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !githubProgress && githubUrlInput.trim()) {
                      handleGitHubScan();
                    }
                  }}
                  placeholder="https://github.com/owner/repository"
                  className="flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-xs font-mono text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                />
                <button
                  onClick={() => handleGitHubScan()}
                  disabled={Boolean(githubProgress) || !githubUrlInput.trim()}
                  className="flex items-center justify-center gap-2 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-50 px-5 py-2.5 text-xs font-extrabold text-slate-950 transition cursor-pointer shrink-0"
                >
                  {githubProgress ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Scanning...</span>
                    </>
                  ) : (
                    <>
                      <Orbit className="h-4 w-4" />
                      <span>Launch 3D Galaxy</span>
                    </>
                  )}
                </button>
              </div>

              {/* Live Progress Bar */}
              {githubProgress && (
                <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-sky-200">
                    <span>{githubProgress.stage}</span>
                    <span className="font-mono font-bold">
                      {Math.round(
                        (githubProgress.loaded / Math.max(1, githubProgress.total)) * 100
                      )}
                      %
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-900 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-sky-400 to-indigo-500 transition-all duration-200"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.round(
                            (githubProgress.loaded / Math.max(1, githubProgress.total)) * 100
                          )
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {githubError && (
                <div className="rounded-xl border border-rose-500/40 bg-rose-500/15 px-3 py-2 text-xs text-rose-200">
                  {githubError}
                </div>
              )}

              {/* 1-Click Open-Source Presets */}
              <div className="pt-1">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                  Or Try a 1-Click Open-Source Repository:
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {SAMPLE_GITHUB_REPOS.map((repo) => (
                    <button
                      key={repo.url}
                      disabled={Boolean(githubProgress)}
                      onClick={() => {
                        setGithubUrlInput(repo.url);
                        handleGitHubScan(repo.url);
                      }}
                      className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/80 hover:border-sky-500/50 hover:bg-slate-900 px-3 py-2 text-left transition cursor-pointer"
                    >
                      <div className="min-w-0">
                        <div className="font-mono text-xs font-bold text-sky-300 truncate">
                          {repo.label}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate">
                          {repo.desc}
                        </div>
                      </div>
                      <ArrowUpRight className="h-3.5 w-3.5 text-slate-500 shrink-0 ml-2" />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Option 2: Scan Local Folder */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-2xl border border-indigo-500/30 bg-indigo-950/20 p-4">
              <div>
                <h2 className="text-xs font-bold uppercase tracking-wider text-indigo-300 flex items-center gap-1.5">
                  <FolderOpen className="h-4 w-4 text-indigo-400" />
                  <span>Option 2: Scan a Local Project Folder</span>
                </h2>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  100% client-side in your browser — your source code never leaves your computer.
                </p>
              </div>
              <button
                onClick={() => folderInputRef.current?.click()}
                disabled={isScanning || Boolean(githubProgress)}
                className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-xl border border-indigo-500/50 bg-indigo-600/30 hover:bg-indigo-600/45 px-4 py-2.5 text-xs font-bold text-indigo-100 transition cursor-pointer shrink-0"
              >
                <FolderOpen className="h-4 w-4 text-indigo-300" />
                <span>{isScanning ? 'Scanning...' : 'Select Local Folder'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOP FLOATING COMMAND BAR (shown when a project is loaded) */}
      {!isEmptyState && (
        <header className="absolute top-3 left-3 right-3 z-20 flex flex-wrap items-center justify-between gap-2.5 pointer-events-none">
          {/* Brand, Project Stats & Health Score Badge */}
          <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-slate-800/80 bg-slate-950/85 px-3.5 py-2 shadow-2xl backdrop-blur-xl">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 via-indigo-500 to-purple-600 shadow-lg shadow-sky-500/20">
              <Orbit className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-extrabold tracking-tight text-white">
                  Codebase Galaxy <span className="text-sky-400">3D</span>
                </h1>
                <span className="rounded-full bg-sky-500/15 border border-sky-500/30 px-2 py-0.5 text-[10px] font-bold text-sky-300">
                  {projectName}
                </span>
                <button
                  onClick={() => {
                    setColorMode((m) => (m === 'heatmap' ? 'cluster' : 'heatmap'));
                    setLeftTab('health');
                    setLeftPanelOpen(true);
                  }}
                  title="View Code Health & Complexity Heatmap"
                  className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold border transition cursor-pointer ${
                    healthReport.circularCycles.length > 0
                      ? 'bg-rose-500/20 border-rose-500/50 text-rose-300 animate-pulse'
                      : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25'
                  }`}
                >
                  <Activity className="h-3 w-3" />
                  <span>
                    Health {healthReport.grade} ({healthReport.overallScore})
                  </span>
                </button>
              </div>
              <p className="text-[11px] text-slate-400 font-mono">
                {nodes.length} Nodes • {links.length} Links •{' '}
                <span className="text-amber-300">{healthReport.totalCallLinks} Fn Calls</span>
              </p>
            </div>
          </div>

          {/* Search, Color Mode (Clusters / Heatmap / Calls) & Layout Controls */}
          <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-2xl border border-slate-800/80 bg-slate-950/85 px-3 py-2 shadow-2xl backdrop-blur-xl">
            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search file, fn(), state..."
                className="w-40 sm:w-48 rounded-xl border border-slate-800 bg-slate-900/90 pl-8 pr-7 py-1.5 text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="h-5 w-px bg-slate-800 hidden sm:block" />

            {/* Color & Analysis Mode Switcher */}
            <div className="flex items-center rounded-xl bg-slate-900 p-0.5 border border-slate-800">
              <button
                onClick={() => {
                  setColorMode('cluster');
                  setLeftTab('clusters');
                }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition cursor-pointer ${
                  colorMode === 'cluster'
                    ? 'bg-sky-500 text-slate-950 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Layers className="h-3 w-3" />
                <span>Clusters</span>
              </button>
              <button
                onClick={() => {
                  setColorMode('heatmap');
                  setLeftTab('health');
                  setLeftPanelOpen(true);
                }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition cursor-pointer ${
                  colorMode === 'heatmap'
                    ? 'bg-gradient-to-r from-amber-500 to-rose-500 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Flame className="h-3 w-3" />
                <span>Health Heatmap</span>
              </button>
              <button
                onClick={() => {
                  setColorMode('calls');
                  setShowCallLinks(true);
                }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition cursor-pointer ${
                  colorMode === 'calls'
                    ? 'bg-amber-400 text-slate-950 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Zap className="h-3 w-3" />
                <span>Call Graph</span>
              </button>
            </div>

            <div className="h-5 w-px bg-slate-800 hidden md:block" />

            {/* Layout Mode Pills */}
            <div className="flex items-center rounded-xl bg-slate-900 p-0.5 border border-slate-800">
              <button
                onClick={() => setLayoutMode('galaxy')}
                className={`px-2 py-1 rounded-lg text-[11px] font-semibold transition cursor-pointer ${
                  layoutMode === 'galaxy'
                    ? 'bg-slate-700 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Dandelion
              </button>
              <button
                onClick={() => setLayoutMode('hierarchy')}
                className={`px-2 py-1 rounded-lg text-[11px] font-semibold transition cursor-pointer ${
                  layoutMode === 'hierarchy'
                    ? 'bg-slate-700 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Pyramid
              </button>
              <button
                onClick={() => setLayoutMode('orbital')}
                className={`px-2 py-1 rounded-lg text-[11px] font-semibold transition cursor-pointer ${
                  layoutMode === 'orbital'
                    ? 'bg-slate-700 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Orbital
              </button>
            </div>

            <div className="h-5 w-px bg-slate-800 hidden lg:block" />

            {/* Toggle Buttons */}
            <button
              onClick={() => setAutoRotate((r) => !r)}
              title="Toggle 3D Auto-Orbit"
              className={`flex items-center gap-1 rounded-xl px-2 py-1.5 text-xs font-semibold border transition cursor-pointer ${
                autoRotate
                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                  : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-white'
              }`}
            >
              {autoRotate ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </button>

            <button
              onClick={() => setShowLabels((l) => !l)}
              title="Toggle 3D File Labels"
              className={`flex items-center gap-1 rounded-xl px-2 py-1.5 text-xs font-semibold border transition cursor-pointer ${
                showLabels
                  ? 'border-sky-500/40 bg-sky-500/15 text-sky-300'
                  : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-white'
              }`}
            >
              <Tag className="h-3.5 w-3.5" />
            </button>

            <button
              onClick={() => setShowParticles((p) => !p)}
              title="Toggle Data-Flow Photons"
              className={`flex items-center gap-1 rounded-xl px-2 py-1.5 text-xs font-semibold border transition cursor-pointer ${
                showParticles
                  ? 'border-purple-500/40 bg-purple-500/15 text-purple-300'
                  : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-white'
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
            </button>

            <button
              onClick={() => {
                setSelectedNode(null);
                setResetCameraTrigger((c) => c + 1);
              }}
              title="Reset 3D Camera View"
              className="flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-900 px-2 py-1.5 text-xs font-semibold text-slate-300 hover:border-slate-700 hover:text-white transition cursor-pointer"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* GitHub Repo Loader + Local Folder Scanner + Clear */}
          <div className="pointer-events-auto flex items-center gap-2">
            <button
              onClick={() => {
                setGithubError(null);
                setIsGitHubModalOpen(true);
              }}
              className="flex items-center gap-2 rounded-2xl border border-sky-500/40 bg-sky-500/20 hover:bg-sky-500/30 px-3.5 py-2.5 text-xs font-bold text-sky-200 shadow-lg backdrop-blur-xl transition cursor-pointer"
            >
              <Globe className="h-4 w-4 text-sky-400" />
              <span>GitHub URL</span>
            </button>

            <button
              onClick={() => folderInputRef.current?.click()}
              disabled={isScanning}
              className="flex items-center gap-2 rounded-2xl border border-indigo-500/40 bg-indigo-600/20 hover:bg-indigo-600/30 px-3.5 py-2.5 text-xs font-bold text-indigo-200 shadow-lg backdrop-blur-xl transition cursor-pointer"
            >
              <FolderOpen className="h-4 w-4 text-indigo-400" />
              <span>{isScanning ? 'Scanning...' : 'Scan Folder'}</span>
            </button>

            <button
              onClick={handleClearWorkspace}
              title="Clear current project and return to launchpad"
              className="flex items-center gap-1.5 rounded-2xl border border-slate-800 bg-slate-950/90 px-3 py-2.5 text-xs font-semibold text-slate-300 hover:text-white transition cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Clear</span>
            </button>
          </div>
        </header>
      )}

      {/* LEFT ARCHITECTURE CLUSTERS & CODE HEALTH PANEL */}
      {!isEmptyState && (
        <aside
          className={`absolute top-20 bottom-4 left-3 z-20 flex transition-transform duration-300 ${
            leftPanelOpen ? 'translate-x-0' : '-translate-x-[calc(100%-32px)]'
          }`}
        >
          <div className="w-76 rounded-2xl border border-slate-800/80 bg-slate-950/85 p-3.5 shadow-2xl backdrop-blur-xl flex flex-col justify-between overflow-hidden">
            {/* Left Panel Tab Switcher */}
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-900 p-1 border border-slate-800 mb-3 shrink-0">
              <button
                onClick={() => setLeftTab('clusters')}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11px] font-bold transition cursor-pointer ${
                  leftTab === 'clusters'
                    ? 'bg-slate-800 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Layers className="h-3.5 w-3.5 text-sky-400" />
                <span>Clusters &amp; Space</span>
              </button>
              <button
                onClick={() => {
                  setLeftTab('health');
                  setColorMode('heatmap');
                }}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11px] font-bold transition cursor-pointer ${
                  leftTab === 'health'
                    ? 'bg-slate-800 text-rose-300 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Flame className="h-3.5 w-3.5 text-rose-400" />
                <span>Health &amp; Hotspots</span>
              </button>
            </div>

            <div className="overflow-y-auto pr-1 space-y-4 flex-1">
              {leftTab === 'clusters' ? (
                <>
                  {/* Cluster Legend Header */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                        <Layers className="h-3.5 w-3.5 text-sky-400" />
                        Architecture Clusters
                      </span>
                      {activeClusterFilter && (
                        <button
                          onClick={() => setActiveClusterFilter(null)}
                          className="text-[10px] font-semibold text-sky-400 hover:underline cursor-pointer"
                        >
                          Show All
                        </button>
                      )}
                    </div>

                    <div className="space-y-1">
                      {CLUSTER_META.map((cluster) => {
                        const count = clusterCounts.get(cluster.id) || 0;
                        if (count === 0) return null;
                        const isActive = activeClusterFilter === cluster.id;
                        return (
                          <button
                            key={cluster.id}
                            onClick={() => {
                              setColorMode('cluster');
                              setActiveClusterFilter(isActive ? null : cluster.id);
                            }}
                            className={`w-full flex items-center justify-between rounded-xl px-2.5 py-1.5 text-left text-xs transition cursor-pointer ${
                              isActive
                                ? 'bg-slate-800/90 text-white border border-slate-700'
                                : activeClusterFilter
                                ? 'opacity-45 hover:opacity-80 text-slate-300'
                                : 'hover:bg-slate-900/80 text-slate-300'
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <span
                                className="h-3 w-3 rounded-full shrink-0"
                                style={{
                                  backgroundColor: cluster.color,
                                  boxShadow: `0 0 10px ${cluster.color}`,
                                }}
                              />
                              <span className="truncate font-medium">{cluster.name}</span>
                            </div>
                            <span className="ml-2 rounded-md bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                              {count}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Filter by Node Type */}
                  <div className="pt-2 border-t border-slate-800/80">
                    <div className="flex items-center justify-between mb-2">
                      <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                        <GitBranch className="h-3.5 w-3.5 text-purple-400" />
                        Filter Hierarchy Level
                      </span>
                      {activeKindFilter && (
                        <button
                          onClick={() => setActiveKindFilter(null)}
                          className="text-[10px] font-semibold text-sky-400 hover:underline cursor-pointer"
                        >
                          Reset
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {KIND_LABELS.map((k) => {
                        const active = activeKindFilter === k.id;
                        return (
                          <button
                            key={k.id}
                            onClick={() => setActiveKindFilter(active ? null : k.id)}
                            className={`rounded-lg px-2 py-1 text-[11px] font-semibold border transition cursor-pointer ${
                              active
                                ? 'border-sky-500 bg-sky-500/20 text-sky-200'
                                : 'border-slate-800 bg-slate-900/70 text-slate-400 hover:text-white'
                            }`}
                          >
                            {k.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* 3D Geometry Tuning Sliders */}
                  <div className="pt-2 border-t border-slate-800/80 space-y-2.5">
                    <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      <Sliders className="h-3.5 w-3.5 text-emerald-400" />
                      3D Space Geometry
                    </span>

                    <div>
                      <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                        <span>Galaxy Branch Reach</span>
                        <span className="font-mono text-slate-200">
                          {spreadFactor.toFixed(1)}x
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0.5"
                        max="2.0"
                        step="0.1"
                        value={spreadFactor}
                        onChange={(e) => setSpreadFactor(parseFloat(e.target.value))}
                        className="w-full accent-sky-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                        <span>Dandelion Cluster Radius</span>
                        <span className="font-mono text-slate-200">
                          {dandelionRadius.toFixed(1)}x
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0.4"
                        max="2.2"
                        step="0.1"
                        value={dandelionRadius}
                        onChange={(e) => setDandelionRadius(parseFloat(e.target.value))}
                        className="w-full accent-purple-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                      />
                    </div>
                  </div>
                </>
              ) : (
                /* CODE HEALTH HEATMAP & DIAGNOSTICS TAB */
                <div className="space-y-3.5">
                  <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          Architecture Health
                        </span>
                        <div className="flex items-baseline gap-2 mt-0.5">
                          <span className="text-2xl font-extrabold text-white">
                            {healthReport.overallScore}
                          </span>
                          <span className="text-xs text-slate-400">/ 100</span>
                        </div>
                      </div>
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-xl font-extrabold text-lg border ${
                          healthReport.grade === 'A'
                            ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                            : healthReport.grade === 'B'
                            ? 'bg-sky-500/20 border-sky-500/40 text-sky-300'
                            : 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                        }`}
                      >
                        {healthReport.grade}
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-1.5 text-center text-[10px] font-mono">
                      <div className="rounded-lg bg-slate-950/80 py-1 px-1.5 text-slate-300">
                        {healthReport.totalFiles} Files
                      </div>
                      <div className="rounded-lg bg-slate-950/80 py-1 px-1.5 text-slate-300">
                        {healthReport.totalLines.toLocaleString()} LOC
                      </div>
                      <div className="rounded-lg bg-slate-950/80 py-1 px-1.5 text-amber-300">
                        {healthReport.totalCallLinks} Calls
                      </div>
                    </div>
                  </div>

                  {/* Heatmap Color Legend */}
                  <div className="space-y-1 text-[11px]">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Heatmap Color Key
                    </span>
                    <div className="grid grid-cols-2 gap-1.5 pt-1">
                      <div className="flex items-center gap-2 rounded-lg bg-slate-900/60 px-2 py-1">
                        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]" />
                        <span className="text-slate-300">Clean / Modular</span>
                      </div>
                      <div className="flex items-center gap-2 rounded-lg bg-slate-900/60 px-2 py-1">
                        <span className="h-2.5 w-2.5 rounded-full bg-amber-500 shadow-[0_0_8px_#f59e0b]" />
                        <span className="text-slate-300">Moderate Load</span>
                      </div>
                      <div className="flex items-center gap-2 rounded-lg bg-slate-900/60 px-2 py-1">
                        <span className="h-2.5 w-2.5 rounded-full bg-red-500 shadow-[0_0_8px_#ef4444]" />
                        <span className="text-slate-300">God File (&gt;450L)</span>
                      </div>
                      <div className="flex items-center gap-2 rounded-lg bg-slate-900/60 px-2 py-1">
                        <span className="h-2.5 w-2.5 rounded-full bg-purple-500 shadow-[0_0_8px_#a855f7]" />
                        <span className="text-slate-300">Unused Export</span>
                      </div>
                    </div>
                  </div>

                  {/* Circular Dependency Detector */}
                  <div className="pt-2 border-t border-slate-800/80">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                        <ShieldAlert className="h-3.5 w-3.5 text-rose-400" />
                        Circular Dependencies ({healthReport.circularCycles.length})
                      </span>
                      <button
                        onClick={handleToggleSimulatedCycle}
                        className="text-[10px] font-semibold text-rose-400 hover:underline cursor-pointer"
                      >
                        {hasSimulatedCycle ? 'Clear Demo Cycle' : 'Test Cycle Alert'}
                      </button>
                    </div>

                    {healthReport.circularCycles.length === 0 ? (
                      <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-2 text-xs text-emerald-300">
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                        <span>0 circular import cycles detected!</span>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {healthReport.circularCycles.map((cyc) => (
                          <button
                            key={cyc.id}
                            onClick={() => {
                              if (cyc.nodes[0]) setSelectedNode(cyc.nodes[0]);
                            }}
                            className="w-full text-left rounded-xl border border-rose-500/40 bg-rose-500/15 hover:bg-rose-500/25 p-2 text-xs text-rose-200 transition cursor-pointer"
                          >
                            <div className="flex items-center gap-1.5 font-bold text-rose-300">
                              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                              <span>Cycle Detected</span>
                            </div>
                            <p className="mt-1 font-mono text-[10px] text-rose-100 break-all">
                              {cyc.summary}
                            </p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Top Complexity / God Files */}
                  <div className="pt-2 border-t border-slate-800/80">
                    <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                      <Flame className="h-3.5 w-3.5 text-amber-400" />
                      Complexity Hotspots (LOC &amp; State)
                    </span>
                    <div className="space-y-1.5">
                      {healthReport.godFiles.map(({ node, metric }) => (
                        <button
                          key={node.id}
                          onClick={() => setSelectedNode(node)}
                          className="w-full flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/70 hover:border-slate-700 px-2.5 py-1.5 text-left text-xs transition cursor-pointer"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span
                                className="h-2.5 w-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: metric.heatColor }}
                              />
                              <span className="font-mono font-semibold text-white truncate">
                                {node.label}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-400 truncate mt-0.5">
                              {node.lines} lines • {metric.stateCount} states • {metric.fnCount} fns
                            </p>
                          </div>
                          <span
                            className="ml-2 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold shrink-0"
                            style={{
                              backgroundColor: `${metric.heatColor}20`,
                              color: metric.heatColor,
                            }}
                          >
                            {metric.complexityScore}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Controls Guide */}
            <div className="pt-2.5 border-t border-slate-800/80 text-[10px] text-slate-400 space-y-0.5 shrink-0">
              <p>
                🖱️ <strong className="text-slate-200">Left Drag:</strong> Rotate •{' '}
                <strong className="text-slate-200">Right Drag:</strong> Pan
              </p>
              <p>
                ⚡ <strong className="text-amber-300">Click Function:</strong> Trace Live Call Chain
              </p>
            </div>
          </div>

          {/* Collapse / Expand Handle */}
          <button
            onClick={() => setLeftPanelOpen((o) => !o)}
            className="ml-1.5 self-start mt-4 flex h-9 w-7 items-center justify-center rounded-xl border border-slate-800 bg-slate-950/90 text-slate-400 hover:text-white shadow-lg backdrop-blur-md cursor-pointer"
            title={leftPanelOpen ? 'Hide Panel' : 'Show Panel'}
          >
            {leftPanelOpen ? (
              <ChevronLeft className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        </aside>
      )}

      {/* RIGHT NODE INSPECTOR, CALL-CHAIN TRACER & CODE VIEWER DRAWER */}
      {selectedNode && (
        <aside className="absolute top-20 bottom-4 right-3 z-20 w-80 sm:w-96 rounded-2xl border border-slate-800/90 bg-slate-950/90 p-4 shadow-2xl backdrop-blur-xl flex flex-col justify-between overflow-hidden animate-in fade-in slide-in-from-right-5 duration-200">
          <div className="overflow-y-auto pr-1 space-y-4">
            {/* Header */}
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span
                    className="h-3 w-3 rounded-full shrink-0"
                    style={{
                      backgroundColor:
                        colorMode === 'heatmap' && selectedMetric
                          ? selectedMetric.heatColor
                          : selectedNode.color,
                      boxShadow: `0 0 12px ${
                        colorMode === 'heatmap' && selectedMetric
                          ? selectedMetric.heatColor
                          : selectedNode.color
                      }`,
                    }}
                  />
                  <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-300">
                    {selectedNode.kind}
                  </span>
                  {selectedMetric && (
                    <span
                      className="rounded-md px-2 py-0.5 text-[10px] font-bold uppercase"
                      style={{
                        backgroundColor: `${selectedMetric.heatColor}22`,
                        color: selectedMetric.heatColor,
                      }}
                    >
                      {selectedMetric.status} ({selectedMetric.complexityScore}/100)
                    </span>
                  )}
                </div>
                <h2 className="font-mono text-base font-extrabold text-white break-all">
                  {selectedNode.label}
                </h2>
              </div>
              <button
                onClick={() => setSelectedNode(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* File Path, Description & Health Diagnostics */}
            <div className="rounded-xl border border-slate-800/90 bg-slate-900/70 p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-mono text-sky-400 break-all">
                <FileCode2 className="h-3.5 w-3.5 shrink-0" />
                <span>{selectedNode.filePath}</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                {selectedNode.description}
              </p>
              {selectedMetric && selectedMetric.reasons.length > 0 && (
                <div className="pt-1.5 border-t border-slate-800/80 space-y-1">
                  {selectedMetric.reasons.map((r, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-1.5 text-[11px] text-amber-300/90"
                    >
                      <Flame className="h-3 w-3 shrink-0" />
                      <span>{r}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* DIRECT FUNCTION-CALL TRACER (CALLS & CALLED BY) */}
            {(callChainTrace.directCallees.length > 0 ||
              callChainTrace.directCallers.length > 0 ||
              callChainTrace.multiHopChains.length > 0) && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-300">
                    <Zap className="h-3.5 w-3.5 text-amber-400" />
                    Function Call Graph Tracer
                  </span>
                  <span className="font-mono text-[10px] text-amber-200/80">
                    {callChainTrace.chainNodeIds.size} linked nodes lit
                  </span>
                </div>

                {callChainTrace.directCallees.length > 0 && (
                  <div>
                    <div className="text-[10px] font-semibold uppercase text-slate-400 mb-1">
                      ⚡ Calls Downstream ({callChainTrace.directCallees.length})
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {callChainTrace.directCallees.map((callee) => (
                        <button
                          key={callee.id}
                          onClick={() => setSelectedNode(callee)}
                          className="flex items-center gap-1 rounded-lg border border-amber-500/40 bg-slate-900 hover:bg-amber-500/20 px-2 py-1 text-[11px] font-mono text-amber-200 transition cursor-pointer"
                        >
                          <span>{callee.label}</span>
                          <ArrowUpRight className="h-3 w-3 text-amber-400" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {callChainTrace.directCallers.length > 0 && (
                  <div>
                    <div className="text-[10px] font-semibold uppercase text-slate-400 mb-1">
                      📡 Triggered / Called By ({callChainTrace.directCallers.length})
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {callChainTrace.directCallers.map((caller) => (
                        <button
                          key={caller.id}
                          onClick={() => setSelectedNode(caller)}
                          className="flex items-center gap-1 rounded-lg border border-sky-500/40 bg-slate-900 hover:bg-sky-500/20 px-2 py-1 text-[11px] font-mono text-sky-200 transition cursor-pointer"
                        >
                          <span>{caller.label}</span>
                          <ArrowUpRight className="h-3 w-3 text-sky-400" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {callChainTrace.multiHopChains.length > 0 && (
                  <div>
                    <div className="text-[10px] font-semibold uppercase text-slate-400 mb-1">
                      🔗 Execution Call Chains
                    </div>
                    <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                      {callChainTrace.multiHopChains.map((chain, idx) => (
                        <div
                          key={idx}
                          className="flex items-center flex-wrap gap-1 rounded-lg bg-slate-950/90 border border-slate-800/80 px-2 py-1.5 text-[10px] font-mono"
                        >
                          {chain.map((step, sIdx) => (
                            <React.Fragment key={step.id}>
                              <button
                                onClick={() => setSelectedNode(step)}
                                className={`hover:underline cursor-pointer ${
                                  step.id === selectedNode.id
                                    ? 'font-bold text-amber-300'
                                    : 'text-slate-300 hover:text-white'
                                }`}
                              >
                                {step.label}
                              </button>
                              {sIdx < chain.length - 1 && (
                                <ArrowRight className="h-2.5 w-2.5 text-slate-500 shrink-0" />
                              )}
                            </React.Fragment>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Parent / Upstream Hierarchy */}
            {selectedConnections.parents.length > 0 && (
              <div>
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Parent Hub ({selectedConnections.parents.length})
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {selectedConnections.parents.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setSelectedNode(p)}
                      className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 hover:border-sky-500/50 px-2.5 py-1 text-xs font-mono text-slate-200 transition cursor-pointer"
                    >
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: p.color }}
                      />
                      <span>{p.label}</span>
                      <ArrowUpRight className="h-3 w-3 text-slate-500" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Cross-File Imports */}
            {selectedConnections.imports.length > 0 && (
              <div>
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Connected Module Imports ({selectedConnections.imports.length})
                </h3>
                <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pr-1">
                  {selectedConnections.imports.map((imp) => (
                    <button
                      key={imp.id}
                      onClick={() => setSelectedNode(imp)}
                      className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 hover:border-purple-500/50 px-2.5 py-1 text-xs font-mono text-slate-200 transition cursor-pointer"
                    >
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: imp.color }}
                      />
                      <span>{imp.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Child Dandelion Nodes */}
            {selectedConnections.children.length > 0 && (
              <div>
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Dandelion Child Nodes ({selectedConnections.children.length})
                </h3>
                <div className="grid grid-cols-1 gap-1 max-h-40 overflow-y-auto pr-1">
                  {selectedConnections.children.map((ch) => (
                    <button
                      key={ch.id}
                      onClick={() => setSelectedNode(ch)}
                      className="flex items-center justify-between rounded-lg border border-slate-800/80 bg-slate-900/60 hover:bg-slate-800 px-2.5 py-1.5 text-left text-xs transition cursor-pointer"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: ch.color }}
                        />
                        <span className="font-mono text-slate-200 truncate">
                          {ch.label}
                        </span>
                      </div>
                      <span className="text-[10px] uppercase text-slate-500 ml-2 shrink-0">
                        {ch.kind}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Live Source Code Preview */}
            {selectedNode.codeSnippet && (
              <div>
                <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  <Code2 className="h-3.5 w-3.5 text-sky-400" />
                  <span>Source Code Preview</span>
                </div>
                <pre className="rounded-xl border border-slate-800 bg-[#050814] p-3 font-mono text-[11px] leading-relaxed text-sky-200 overflow-x-auto max-h-60">
                  <code>{selectedNode.codeSnippet}</code>
                </pre>
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
            <span>Lines: {selectedNode.lines}</span>
            <button
              onClick={() => {
                setSelectedNode(null);
                setResetCameraTrigger((c) => c + 1);
              }}
              className="text-sky-400 hover:underline font-semibold cursor-pointer"
            >
              Zoom Back to Full Galaxy
            </button>
          </div>
        </aside>
      )}

      {/* PASTE GITHUB REPOSITORY URL MODAL */}
      {isGitHubModalOpen && (
        <div
          onClick={() => !githubProgress && setIsGitHubModalOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-950 p-6 shadow-2xl space-y-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/20 border border-sky-500/40 text-sky-400">
                  <Globe className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-extrabold text-white">
                    Visualize Any GitHub Repository in 3D
                  </h2>
                  <p className="text-xs text-slate-400">
                    Fetches the live Git tree, parses functions &amp; call chains, and builds a 3D galaxy.
                  </p>
                </div>
              </div>
              {!githubProgress && (
                <button
                  onClick={() => setIsGitHubModalOpen(false)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">
                Public GitHub URL or owner/repo
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={githubUrlInput}
                  disabled={Boolean(githubProgress)}
                  onChange={(e) => setGithubUrlInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !githubProgress) {
                      handleGitHubScan();
                    }
                  }}
                  placeholder="https://github.com/owner/repository"
                  className="flex-1 rounded-xl border border-slate-800 bg-slate-900 px-3.5 py-2.5 text-xs font-mono text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                />
                <button
                  onClick={() => handleGitHubScan()}
                  disabled={Boolean(githubProgress) || !githubUrlInput.trim()}
                  className="flex items-center gap-2 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-50 px-4 py-2.5 text-xs font-extrabold text-slate-950 transition cursor-pointer"
                >
                  {githubProgress ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Scanning...</span>
                    </>
                  ) : (
                    <>
                      <Orbit className="h-4 w-4" />
                      <span>Launch 3D</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {githubProgress && (
              <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs text-sky-200">
                  <span className="font-medium">{githubProgress.stage}</span>
                  <span className="font-mono font-bold">
                    {Math.round(
                      (githubProgress.loaded / Math.max(1, githubProgress.total)) * 100
                    )}
                    %
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-900 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-sky-400 to-indigo-500 transition-all duration-200"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round(
                          (githubProgress.loaded / Math.max(1, githubProgress.total)) * 100
                        )
                      )}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {githubError && (
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/15 px-3.5 py-2.5 text-xs text-rose-200">
                {githubError}
              </div>
            )}

            <div className="space-y-2">
              <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Or Try a 1-Click Open-Source Repository
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {SAMPLE_GITHUB_REPOS.map((repo) => (
                  <button
                    key={repo.url}
                    disabled={Boolean(githubProgress)}
                    onClick={() => {
                      setGithubUrlInput(repo.url);
                      handleGitHubScan(repo.url);
                    }}
                    className="flex flex-col items-start rounded-xl border border-slate-800 bg-slate-900/70 hover:border-sky-500/50 hover:bg-slate-900 p-3 text-left transition cursor-pointer"
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="font-mono text-xs font-bold text-sky-300">
                        {repo.label}
                      </span>
                      <ArrowUpRight className="h-3.5 w-3.5 text-slate-500" />
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400 line-clamp-1">
                      {repo.desc}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
