import { GalaxyLink, GalaxyNode } from '../data/galaxyTypes';

export type ColorMode = 'cluster' | 'heatmap' | 'calls';

export type HealthStatus = 'healthy' | 'moderate' | 'critical' | 'circular' | 'orphan';

export interface NodeHealthMetric {
  nodeId: string;
  status: HealthStatus;
  heatColor: string;
  complexityScore: number; // 0 (clean) to 100 (critical hotspot)
  reasons: string[];
  fanIn: number;
  fanOut: number;
  stateCount: number;
  fnCount: number;
  isCircular: boolean;
  isOrphanExport: boolean;
}

export interface CircularDependencyCycle {
  id: string;
  nodes: GalaxyNode[];
  summary: string;
}

export interface CodeHealthReport {
  overallScore: number;
  grade: 'A' | 'B' | 'C' | 'D';
  totalLines: number;
  totalFiles: number;
  totalFunctions: number;
  totalCallLinks: number;
  nodeMetrics: Map<string, NodeHealthMetric>;
  circularCycles: CircularDependencyCycle[];
  circularNodeIds: Set<string>;
  circularEdgeKeys: Set<string>;
  godFiles: { node: GalaxyNode; metric: NodeHealthMetric }[];
  couplingHotspots: { node: GalaxyNode; metric: NodeHealthMetric }[];
  orphanExports: GalaxyNode[];
}

export interface CallChainTrace {
  directCallers: GalaxyNode[];
  directCallees: GalaxyNode[];
  multiHopChains: GalaxyNode[][];
  chainNodeIds: Set<string>;
  chainEdgeKeys: Set<string>;
}

/**
 * Analyzes the entire 3D graph for Code Health, Complexity Heatmaps,
 * Circular Dependencies, God Components, and Orphan Exports.
 */
export function analyzeCodebaseHealth(
  nodes: GalaxyNode[],
  links: GalaxyLink[]
): CodeHealthReport {
  const nodeMap = new Map<string, GalaxyNode>();
  for (const n of nodes) nodeMap.set(n.id, n);

  const fanInMap = new Map<string, number>();
  const fanOutMap = new Map<string, number>();
  const stateCountByFile = new Map<string, number>();
  const fnCountByFile = new Map<string, number>();
  const incomingCallCount = new Map<string, number>();

  // Build adjacency for file-level import cycle detection
  const importAdj = new Map<string, string[]>();

  for (const n of nodes) {
    if (n.kind === 'state') {
      const filePart = n.filePath.split('#')[0];
      const fileId = `file:${filePart}`;
      stateCountByFile.set(fileId, (stateCountByFile.get(fileId) || 0) + 1);
    } else if (n.kind === 'function') {
      const filePart = n.filePath.split('#')[0];
      const fileId = `file:${filePart}`;
      fnCountByFile.set(fileId, (fnCountByFile.get(fileId) || 0) + 1);
    }
  }

  for (const l of links) {
    if (l.kind === 'import' || l.kind === 'call' || l.kind === 'circular') {
      fanOutMap.set(l.source, (fanOutMap.get(l.source) || 0) + 1);
      fanInMap.set(l.target, (fanInMap.get(l.target) || 0) + 1);
    }
    if (l.kind === 'call') {
      incomingCallCount.set(l.target, (incomingCallCount.get(l.target) || 0) + 1);
    }
    if (l.kind === 'import' || l.kind === 'circular') {
      const list = importAdj.get(l.source) || [];
      list.push(l.target);
      importAdj.set(l.source, list);
    }
  }

  // 1. Detect Circular Dependencies across files via DFS
  const circularCycles: CircularDependencyCycle[] = [];
  const circularNodeIds = new Set<string>();
  const circularEdgeKeys = new Set<string>();
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const pathStack: string[] = [];
  const seenCycleSignatures = new Set<string>();

  const dfsCycle = (curr: string) => {
    visited.add(curr);
    inStack.add(curr);
    pathStack.push(curr);

    const neighbors = importAdj.get(curr) || [];
    for (const next of neighbors) {
      if (!visited.has(next)) {
        dfsCycle(next);
      } else if (inStack.has(next)) {
        const cycleStartIdx = pathStack.indexOf(next);
        if (cycleStartIdx !== -1) {
          const cycleIds = pathStack.slice(cycleStartIdx);
          const sig = [...cycleIds].sort().join('|');
          if (!seenCycleSignatures.has(sig)) {
            seenCycleSignatures.add(sig);
            const cycleNodes = cycleIds
              .map((id) => nodeMap.get(id))
              .filter((x): x is GalaxyNode => Boolean(x));

            for (let i = 0; i < cycleIds.length; i++) {
              const a = cycleIds[i];
              const b = cycleIds[(i + 1) % cycleIds.length];
              circularNodeIds.add(a);
              circularEdgeKeys.add(`${a}->${b}`);
              circularEdgeKeys.add(`${b}->${a}`);
            }

            circularCycles.push({
              id: `cycle-${circularCycles.length + 1}`,
              nodes: cycleNodes,
              summary: [...cycleNodes.map((n) => n.label), cycleNodes[0]?.label || ''].join(' ➔ '),
            });
          }
        }
      }
    }

    pathStack.pop();
    inStack.delete(curr);
  };

  for (const n of nodes) {
    if (n.kind === 'file' && !visited.has(n.id)) {
      dfsCycle(n.id);
    }
  }

  // Also check if any link was explicitly marked 'circular'
  for (const l of links) {
    if (l.kind === 'circular') {
      circularNodeIds.add(l.source);
      circularNodeIds.add(l.target);
      circularEdgeKeys.add(`${l.source}->${l.target}`);
    }
  }

  // 2. Compute per-node Health & Heatmap Color
  const nodeMetrics = new Map<string, NodeHealthMetric>();
  const orphanExports: GalaxyNode[] = [];

  let totalLines = 0;
  let totalFiles = 0;
  let totalFunctions = 0;

  for (const n of nodes) {
    const fanIn = fanInMap.get(n.id) || 0;
    const fanOut = fanOutMap.get(n.id) || 0;
    const stateCount = stateCountByFile.get(n.id) || 0;
    const fnCount = fnCountByFile.get(n.id) || 0;
    const isCircular = circularNodeIds.has(n.id);
    const reasons: string[] = [];

    if (n.kind === 'file') {
      totalFiles++;
      totalLines += n.lines || 0;
    } else if (n.kind === 'function') {
      totalFunctions++;
    }

    // Check if exported function/constant has 0 callers
    const isOrphanExport =
      Boolean(n.isExported) &&
      (n.kind === 'function' || n.kind === 'constant') &&
      (incomingCallCount.get(n.id) || 0) === 0 &&
      !['App', 'main'].includes(n.label.replace('()', ''));

    if (isOrphanExport) {
      orphanExports.push(n);
    }

    // Calculate complexity score (0 - 100)
    let score = 12;
    if (n.kind === 'file') {
      const locScore = Math.min(55, (n.lines / 650) * 55);
      const stateScore = Math.min(25, stateCount * 2.1);
      const couplingScore = Math.min(20, (fanIn + fanOut) * 2.2);
      score = Math.round(locScore + stateScore + couplingScore);

      if (n.lines > 550) reasons.push(`Large monolith file (${n.lines} LOC)`);
      else if (n.lines > 280) reasons.push(`Moderate file size (${n.lines} LOC)`);

      if (stateCount >= 10) reasons.push(`High React state density (${stateCount} useState hooks)`);
      else if (stateCount >= 5) reasons.push(`${stateCount} state hooks`);

      if (fanIn + fanOut >= 7) reasons.push(`High module coupling (${fanIn} in / ${fanOut} out)`);
    } else if (n.kind === 'function' || n.kind === 'hook') {
      score = Math.min(95, 18 + (fanIn + fanOut) * 12 + (n.lines > 25 ? 25 : 0));
      if (fanOut >= 4) reasons.push(`Calls ${fanOut} downstream functions`);
      if (fanIn >= 4) reasons.push(`Shared utility called by ${fanIn} functions`);
      if (isOrphanExport) reasons.push('Exported symbol with 0 internal callers');
    } else {
      // Inherit parent file's approximate complexity for leaf nodes
      const filePart = n.filePath.split('#')[0];
      const parentFile = nodeMap.get(`file:${filePart}`);
      const pLines = parentFile?.lines || n.lines || 20;
      score = Math.min(90, Math.round((pLines / 800) * 60) + 15);
    }

    if (isCircular) {
      score = Math.max(score, 92);
      reasons.unshift('Part of a Circular Dependency cycle');
    }

    let status: HealthStatus = 'healthy';
    let heatColor = '#10b981'; // Emerald Green (Healthy)

    if (isCircular) {
      status = 'circular';
      heatColor = '#f43f5e'; // Neon Rose/Crimson
    } else if (score >= 70 || (n.kind === 'file' && n.lines > 550)) {
      status = 'critical';
      heatColor = '#ef4444'; // Crimson Red (God File / Hotspot)
    } else if (score >= 42 || (n.kind === 'file' && n.lines > 240)) {
      status = 'moderate';
      heatColor = '#f59e0b'; // Amber Gold (Moderate Complexity)
    } else if (isOrphanExport) {
      status = 'orphan';
      heatColor = '#a855f7'; // Violet (Unreferenced Export)
    } else {
      status = 'healthy';
      heatColor = '#10b981'; // Emerald (Clean)
    }

    if (n.kind === 'root') {
      heatColor = '#ffffff';
    }

    if (reasons.length === 0) {
      reasons.push('Clean modular unit with low coupling');
    }

    nodeMetrics.set(n.id, {
      nodeId: n.id,
      status,
      heatColor,
      complexityScore: score,
      reasons,
      fanIn,
      fanOut,
      stateCount,
      fnCount,
      isCircular,
      isOrphanExport,
    });
  }

  // 3. Rank God Files & Coupling Hotspots
  const fileEntries = nodes
    .filter((n) => n.kind === 'file')
    .map((node) => ({ node, metric: nodeMetrics.get(node.id)! }));

  const godFiles = [...fileEntries]
    .sort((a, b) => b.metric.complexityScore - a.metric.complexityScore || b.node.lines - a.node.lines)
    .slice(0, 6);

  const couplingHotspots = nodes
    .filter((n) => n.kind === 'file' || n.kind === 'function')
    .map((node) => ({ node, metric: nodeMetrics.get(node.id)! }))
    .filter((item) => item.metric.fanIn + item.metric.fanOut > 0)
    .sort((a, b) => b.metric.fanIn + b.metric.fanOut - (a.metric.fanIn + a.metric.fanOut))
    .slice(0, 6);

  const totalCallLinks = links.filter((l) => l.kind === 'call').length;

  // Compute Overall Architecture Score (0 - 100)
  const criticalFileCount = fileEntries.filter((f) => f.metric.status === 'critical').length;
  const penalty =
    circularCycles.length * 12 +
    criticalFileCount * 7 +
    Math.min(10, Math.floor(orphanExports.length * 1.5));
  const overallScore = Math.max(45, Math.min(98, 96 - penalty));
  const grade: CodeHealthReport['grade'] =
    overallScore >= 88 ? 'A' : overallScore >= 76 ? 'B' : overallScore >= 64 ? 'C' : 'D';

  return {
    overallScore,
    grade,
    totalLines,
    totalFiles,
    totalFunctions,
    totalCallLinks,
    nodeMetrics,
    circularCycles,
    circularNodeIds,
    circularEdgeKeys,
    godFiles,
    couplingHotspots,
    orphanExports: orphanExports.slice(0, 12),
  };
}

/**
 * Traces upstream callers, downstream callees, and multi-hop execution call chains
 * for any selected node (function, hook, or file).
 */
export function traceFunctionCallChain(
  selectedNode: GalaxyNode | null,
  nodes: GalaxyNode[],
  links: GalaxyLink[]
): CallChainTrace {
  const empty: CallChainTrace = {
    directCallers: [],
    directCallees: [],
    multiHopChains: [],
    chainNodeIds: new Set(),
    chainEdgeKeys: new Set(),
  };
  if (!selectedNode) return empty;

  const nodeMap = new Map<string, GalaxyNode>();
  for (const n of nodes) nodeMap.set(n.id, n);

  const callLinks = links.filter((l) => l.kind === 'call');

  // If user selected a file, gather all functions inside that file as starting seeds
  const seedIds = new Set<string>([selectedNode.id]);
  if (selectedNode.kind === 'file') {
    for (const l of links) {
      if (l.source === selectedNode.id && (l.target.startsWith('fn:') || l.target.startsWith('memo:'))) {
        seedIds.add(l.target);
      }
    }
  }

  const callersMap = new Map<string, string[]>(); // target -> sources
  const calleesMap = new Map<string, string[]>(); // source -> targets

  for (const cl of callLinks) {
    const outList = calleesMap.get(cl.source) || [];
    outList.push(cl.target);
    calleesMap.set(cl.source, outList);

    const inList = callersMap.get(cl.target) || [];
    inList.push(cl.source);
    callersMap.set(cl.target, inList);
  }

  const directCallerIds = new Set<string>();
  const directCalleeIds = new Set<string>();
  const chainNodeIds = new Set<string>(seedIds);
  const chainEdgeKeys = new Set<string>();

  for (const seed of seedIds) {
    for (const callerId of callersMap.get(seed) || []) {
      if (!seedIds.has(callerId)) directCallerIds.add(callerId);
      chainNodeIds.add(callerId);
      chainEdgeKeys.add(`${callerId}->${seed}`);
    }
    for (const calleeId of calleesMap.get(seed) || []) {
      if (!seedIds.has(calleeId)) directCalleeIds.add(calleeId);
      chainNodeIds.add(calleeId);
      chainEdgeKeys.add(`${seed}->${calleeId}`);
    }
  }

  // Build multi-hop forward and backward execution paths (up to depth 3)
  const multiHopChains: GalaxyNode[][] = [];

  for (const seed of seedIds) {
    const seedNode = nodeMap.get(seed);
    if (!seedNode) continue;

    const firstCallees = calleesMap.get(seed) || [];
    for (const c1 of firstCallees) {
      const n1 = nodeMap.get(c1);
      if (!n1) continue;
      chainNodeIds.add(c1);
      chainEdgeKeys.add(`${seed}->${c1}`);

      const secondCallees = (calleesMap.get(c1) || []).filter((c2) => c2 !== seed && c2 !== c1);
      if (secondCallees.length === 0) {
        // Also check if seed had an upstream caller to show Caller -> Seed -> Callee
        const upstream = (callersMap.get(seed) || [])[0];
        const upNode = upstream ? nodeMap.get(upstream) : null;
        if (upNode) {
          multiHopChains.push([upNode, seedNode, n1]);
        } else {
          multiHopChains.push([seedNode, n1]);
        }
      } else {
        for (const c2 of secondCallees.slice(0, 3)) {
          const n2 = nodeMap.get(c2);
          if (!n2) continue;
          chainNodeIds.add(c2);
          chainEdgeKeys.add(`${c1}->${c2}`);
          multiHopChains.push([seedNode, n1, n2]);
        }
      }
    }

    // If this function is a leaf utility (called by others, calls nothing), trace Caller -> Seed
    if (firstCallees.length === 0) {
      for (const callerId of (callersMap.get(seed) || []).slice(0, 5)) {
        const callerNode = nodeMap.get(callerId);
        if (!callerNode) continue;
        const grandCallers = callersMap.get(callerId) || [];
        if (grandCallers.length > 0) {
          const gcNode = nodeMap.get(grandCallers[0]);
          if (gcNode) {
            chainNodeIds.add(gcNode.id);
            chainEdgeKeys.add(`${gcNode.id}->${callerId}`);
            multiHopChains.push([gcNode, callerNode, seedNode]);
            continue;
          }
        }
        multiHopChains.push([callerNode, seedNode]);
      }
    }
  }

  const directCallers = Array.from(directCallerIds)
    .map((id) => nodeMap.get(id))
    .filter((n): n is GalaxyNode => Boolean(n));

  const directCallees = Array.from(directCalleeIds)
    .map((id) => nodeMap.get(id))
    .filter((n): n is GalaxyNode => Boolean(n));

  return {
    directCallers,
    directCallees,
    multiHopChains: multiHopChains.slice(0, 10),
    chainNodeIds,
    chainEdgeKeys,
  };
}
