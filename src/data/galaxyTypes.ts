export interface GalaxyNode {
  id: string;
  label: string;
  kind:
    | 'root'
    | 'folder'
    | 'file'
    | 'function'
    | 'state'
    | 'hook'
    | 'interface'
    | 'property'
    | 'constant'
    | 'database';
  clusterId: string;
  clusterName: string;
  color: string;
  size: number;
  filePath: string;
  lines: number;
  description: string;
  codeSnippet?: string;
  isExported?: boolean;
}

export interface GalaxyLink {
  source: string;
  target: string;
  kind: 'hierarchy' | 'dandelion' | 'import' | 'call' | 'circular';
  strength: number;
}

export const CLUSTER_META = [
  { id: 'cluster-app', name: 'App Core & State Hub', color: '#38bdf8', glow: '#0284c7' },
  { id: 'cluster-ui', name: 'UI Modals & Forms', color: '#a855f7', glow: '#7e22ce' },
  { id: 'cluster-actions', name: 'Actions & Workflows', color: '#10b981', glow: '#059669' },
  { id: 'cluster-engine', name: 'Core Engine & Utilities', color: '#f97316', glow: '#ea580c' },
  { id: 'cluster-visual', name: 'Visuals, Charts & 3D', color: '#ec4899', glow: '#db2777' },
  { id: 'cluster-types', name: 'TypeScript Schema & Models', color: '#eab308', glow: '#ca8a04' },
  { id: 'cluster-services', name: 'API, Services & Auth', color: '#06b6d4', glow: '#0891b2' },
  { id: 'cluster-social', name: 'Events, Feeds & Notifications', color: '#8b5cf6', glow: '#6d28d9' },
  { id: 'cluster-settings', name: 'User Profile & Config', color: '#22c55e', glow: '#16a34a' },
  { id: 'cluster-views', name: 'Lists, Tables & Cards', color: '#f43f5e', glow: '#e11d48' },
  { id: 'cluster-build', name: 'Build & Tooling Config', color: '#60a5fa', glow: '#2563eb' },
];
