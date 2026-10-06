import { CLUSTER_META, GalaxyLink, GalaxyNode } from '../data/galaxyTypes';

export interface VirtualSourceFile {
  relPath: string;
  name: string;
  content: string;
}

function inferClusterForFile(relPath: string, fallbackIndex: number) {
  const lower = relPath.toLowerCase();
  if (lower.includes('app.') || lower.includes('main.') || lower.includes('index.') || lower.includes('core') || lower.includes('store')) {
    return CLUSTER_META[0];
  }
  if (lower.includes('expense') || lower.includes('modal') || lower.includes('dialog') || lower.includes('form')) {
    return CLUSTER_META[1];
  }
  if (lower.includes('settle') || lower.includes('pay') || lower.includes('checkout') || lower.includes('action')) {
    return CLUSTER_META[2];
  }
  if (lower.includes('engine') || lower.includes('math') || lower.includes('calc') || lower.includes('util') || lower.includes('helper')) {
    return CLUSTER_META[3];
  }
  if (lower.includes('chart') || lower.includes('analytic') || lower.includes('graph') || lower.includes('canvas') || lower.includes('3d')) {
    return CLUSTER_META[4];
  }
  if (lower.includes('type') || lower.includes('schema') || lower.includes('model') || lower.includes('interface') || lower.includes('data')) {
    return CLUSTER_META[5];
  }
  if (lower.includes('firebase') || lower.includes('api') || lower.includes('auth') || lower.includes('db') || lower.includes('service') || lower.includes('fetch')) {
    return CLUSTER_META[6];
  }
  if (lower.includes('comment') || lower.includes('feed') || lower.includes('chat') || lower.includes('social') || lower.includes('notif')) {
    return CLUSTER_META[7];
  }
  if (lower.includes('profile') || lower.includes('user') || lower.includes('account') || lower.includes('onboard') || lower.includes('settings')) {
    return CLUSTER_META[8];
  }
  if (lower.includes('group') || lower.includes('team') || lower.includes('list') || lower.includes('table') || lower.includes('card')) {
    return CLUSTER_META[9];
  }
  return CLUSTER_META[fallbackIndex % CLUSTER_META.length];
}

/**
 * Shared deep parser used by both "Scan Any Folder" and "Load GitHub Repo URL"
 * Extracts files, folders, functions, state sub-hubs, memos, interfaces, properties,
 * cross-file imports, and direct function-to-function call links!
 */
export function buildGalaxyFromVirtualFiles(
  projectName: string,
  virtualFiles: VirtualSourceFile[]
): {
  projectName: string;
  nodes: GalaxyNode[];
  links: GalaxyLink[];
} {
  const nodes: GalaxyNode[] = [];
  const links: GalaxyLink[] = [];
  const nodeSet = new Set<string>();
  const linkSet = new Set<string>();

  const addNode = (node: GalaxyNode) => {
    if (nodeSet.has(node.id)) return;
    nodeSet.add(node.id);
    nodes.push(node);
  };

  const addLink = (
    source: string,
    target: string,
    kind: GalaxyLink['kind'] = 'hierarchy',
    strength = 1
  ) => {
    if (!nodeSet.has(source) || !nodeSet.has(target) || source === target) return;
    const key = `${source}->${target}:${kind}`;
    if (linkSet.has(key)) return;
    linkSet.add(key);
    links.push({ source, target, kind, strength });
  };

  const rootId = `root:${projectName}`;
  addNode({
    id: rootId,
    label: `${projectName} Core`,
    kind: 'root',
    clusterId: CLUSTER_META[0].id,
    clusterName: CLUSTER_META[0].name,
    color: '#ffffff',
    size: 16,
    filePath: `${projectName}/`,
    lines: 0,
    description: `Root nucleus for ${projectName} (${virtualFiles.length} source files analyzed).`,
  });

  const fileIdByBasename = new Map<string, string>();
  const callableNodes: {
    id: string;
    name: string;
    fileRelPath: string;
    bodyText: string;
  }[] = [];

  for (let idx = 0; idx < virtualFiles.length; idx++) {
    const file = virtualFiles[idx];
    const relPath = file.relPath;
    const cluster = inferClusterForFile(relPath, idx);
    const content = file.content;
    const lines = content.split(/\r?\n/);

    const parts = relPath.split('/');
    let parentId = rootId;
    if (parts.length > 1) {
      const folderPath = parts.slice(0, -1).join('/');
      const folderId = `folder:${folderPath}`;
      if (!nodeSet.has(folderId)) {
        addNode({
          id: folderId,
          label: `/${folderPath}`,
          kind: 'folder',
          clusterId: cluster.id,
          clusterName: cluster.name,
          color: cluster.color,
          size: 10,
          filePath: folderPath,
          lines: 0,
          description: `Directory container /${folderPath}`,
        });
        addLink(rootId, folderId, 'hierarchy', 1.4);
      }
      parentId = folderId;
    }

    const fileNodeId = `file:${relPath}`;
    const baseNoExt = file.name.replace(/\.[^.]+$/, '');
    fileIdByBasename.set(baseNoExt, fileNodeId);
    fileIdByBasename.set(file.name, fileNodeId);

    addNode({
      id: fileNodeId,
      label: file.name,
      kind: 'file',
      clusterId: cluster.id,
      clusterName: cluster.name,
      color: cluster.color,
      size: Math.min(13.5, Math.max(7.5, Math.sqrt(lines.length) * 0.42)),
      filePath: relPath,
      lines: lines.length,
      description: `Source file (${lines.length} lines) in ${cluster.name}`,
      codeSnippet: lines.slice(0, 38).join('\n'),
    });
    addLink(parentId, fileNodeId, 'hierarchy', 1.2);

    // 1. Extract Functions & Arrow Handlers (JS/TS/Python)
    const fnRegex =
      /(export\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_]+)|(export\s+)?const\s+([a-zA-Z0-9_]+)\s*(?::\s*[^=]+)?=\s*(?:async\s*)?\([^)]*\)\s*=>|^def\s+([a-zA-Z0-9_]+)\s*\(/gm;
    let match;
    while ((match = fnRegex.exec(content)) !== null) {
      const isExported = Boolean(match[1] || match[3]);
      const fnName = match[2] || match[4] || match[5];
      if (!fnName || fnName.length < 2) continue;
      const lineNum = content.slice(0, match.index).split(/\r?\n/).length;
      const fnId = `fn:${relPath}:${fnName}`;
      const bodyText = lines
        .slice(Math.max(0, lineNum - 1), Math.min(lines.length, lineNum + 80))
        .join('\n');

      addNode({
        id: fnId,
        label: `${fnName}()`,
        kind: 'function',
        clusterId: cluster.id,
        clusterName: cluster.name,
        color: cluster.color,
        size: 4.1,
        filePath: `${relPath}#L${lineNum}`,
        lines: 14,
        description: `${isExported ? 'Exported ' : ''}Function ${fnName}() in ${file.name} (Line ${lineNum})`,
        codeSnippet: lines
          .slice(Math.max(0, lineNum - 1), Math.min(lines.length, lineNum + 18))
          .join('\n'),
        isExported,
      });
      addLink(fileNodeId, fnId, 'dandelion', 2.4);

      callableNodes.push({
        id: fnId,
        name: fnName,
        fileRelPath: relPath,
        bodyText,
      });
    }

    // 2. Extract React useState Hooks (with State Sub-Hub if >= 4 states)
    const stateMatches: { stateName: string; lineNum: number }[] = [];
    const stateRegex = /const\s+\[([a-zA-Z0-9_]+),\s*set[a-zA-Z0-9_]+\]\s*=\s*useState/g;
    while ((match = stateRegex.exec(content)) !== null) {
      const stateName = match[1];
      const lineNum = content.slice(0, match.index).split(/\r?\n/).length;
      stateMatches.push({ stateName, lineNum });
    }

    let stateParentId = fileNodeId;
    if (stateMatches.length >= 4) {
      stateParentId = `subhub:state:${relPath}`;
      addNode({
        id: stateParentId,
        label: `${baseNoExt} State (${stateMatches.length})`,
        kind: 'hook',
        clusterId: cluster.id,
        clusterName: cluster.name,
        color: cluster.color,
        size: 6.0,
        filePath: relPath,
        lines: stateMatches.length,
        description: `Reactive state cluster containing ${stateMatches.length} useState hooks for ${file.name}.`,
      });
      addLink(fileNodeId, stateParentId, 'hierarchy', 1.8);
    }

    for (const st of stateMatches) {
      const stateId = `state:${relPath}:${st.stateName}`;
      addNode({
        id: stateId,
        label: st.stateName,
        kind: 'state',
        clusterId: cluster.id,
        clusterName: cluster.name,
        color: cluster.color,
        size: 3.1,
        filePath: `${relPath}#L${st.lineNum}`,
        lines: 2,
        description: `React state hook ${st.stateName} in ${file.name} (Line ${st.lineNum})`,
        codeSnippet: lines
          .slice(Math.max(0, st.lineNum - 1), Math.min(lines.length, st.lineNum + 4))
          .join('\n'),
      });
      addLink(stateParentId, stateId, 'dandelion', 2.6);
    }

    // 3. Extract useMemo / useCallback hooks
    const memoRegex = /const\s+([a-zA-Z0-9_]+)\s*=\s*(?:useMemo|useCallback)/g;
    while ((match = memoRegex.exec(content)) !== null) {
      const memoName = match[1];
      const lineNum = content.slice(0, match.index).split(/\r?\n/).length;
      const memoId = `memo:${relPath}:${memoName}`;
      const bodyText = lines
        .slice(Math.max(0, lineNum - 1), Math.min(lines.length, lineNum + 45))
        .join('\n');

      addNode({
        id: memoId,
        label: `useMemo(${memoName})`,
        kind: 'hook',
        clusterId: cluster.id,
        clusterName: cluster.name,
        color: cluster.color,
        size: 3.8,
        filePath: `${relPath}#L${lineNum}`,
        lines: 12,
        description: `Memoized hook ${memoName} in ${file.name} (Line ${lineNum})`,
        codeSnippet: lines
          .slice(Math.max(0, lineNum - 1), Math.min(lines.length, lineNum + 15))
          .join('\n'),
      });
      addLink(fileNodeId, memoId, 'dandelion', 2.4);

      callableNodes.push({
        id: memoId,
        name: memoName,
        fileRelPath: relPath,
        bodyText,
      });
    }

    // 4. Extract TypeScript Interfaces & Properties
    const ifaceRegex = /(export\s+)?interface\s+([a-zA-Z0-9_]+)\s*\{([^}]+)\}/g;
    while ((match = ifaceRegex.exec(content)) !== null) {
      const isExported = Boolean(match[1]);
      const ifaceName = match[2];
      const body = match[3];
      const lineNum = content.slice(0, match.index).split(/\r?\n/).length;
      const ifaceId = `type:${relPath}:${ifaceName}`;
      addNode({
        id: ifaceId,
        label: `interface ${ifaceName}`,
        kind: 'interface',
        clusterId: cluster.id,
        clusterName: cluster.name,
        color: cluster.color,
        size: 5.5,
        filePath: `${relPath}#L${lineNum}`,
        lines: 8,
        description: `TypeScript Interface ${ifaceName} in ${file.name}`,
        codeSnippet: match[0],
        isExported,
      });
      addLink(fileNodeId, ifaceId, 'hierarchy', 1.9);

      for (const fl of body.split(/\r?\n/)) {
        const fm = fl.trim().match(/^([a-zA-Z0-9_]+)\??\s*:\s*([^;]+)/);
        if (fm) {
          const fieldId = `field:${relPath}:${ifaceName}.${fm[1]}`;
          addNode({
            id: fieldId,
            label: `.${fm[1]}`,
            kind: 'property',
            clusterId: cluster.id,
            clusterName: cluster.name,
            color: cluster.color,
            size: 2.6,
            filePath: `${relPath}#L${lineNum}`,
            lines: 1,
            description: `${ifaceName}.${fm[1]}: ${fm[2].trim()}`,
          });
          addLink(ifaceId, fieldId, 'dandelion', 3.0);
        }
      }
    }
  }

  // 5. Cross-file imports
  for (const file of virtualFiles) {
    const sourceId = `file:${file.relPath}`;
    const importRegex = /from\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(file.content)) !== null) {
      const imp = match[1];
      if (imp.startsWith('.')) {
        const parts = imp.split('/');
        const base = parts[parts.length - 1].replace(/\.[^.]+$/, '');
        const targetId = fileIdByBasename.get(base);
        if (targetId) {
          addLink(sourceId, targetId, 'import', 0.9);
        }
      }
    }
  }

  // 6. Direct Function-to-Function Call Tracing
  for (const caller of callableNodes) {
    const bodyWithoutHeader = caller.bodyText.split('\n').slice(1).join('\n');
    for (const callee of callableNodes) {
      if (caller.id === callee.id) continue;
      const escaped = callee.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const callPattern = new RegExp(`\\b${escaped}\\s*(\\(|<)`, 'g');
      if (callPattern.test(bodyWithoutHeader)) {
        addLink(caller.id, callee.id, 'call', 1.5);
      }
    }
  }

  return { projectName, nodes, links };
}

export async function scanUploadedFiles(fileList: FileList): Promise<{
  projectName: string;
  nodes: GalaxyNode[];
  links: GalaxyLink[];
}> {
  const virtualFiles: VirtualSourceFile[] = [];
  let rootFolderName = 'CustomProject';

  for (let i = 0; i < fileList.length; i++) {
    const f = fileList[i];
    const rel = f.webkitRelativePath || f.name;
    if (
      rel.includes('node_modules/') ||
      rel.includes('.git/') ||
      rel.includes('dist/') ||
      rel.includes('build/') ||
      rel.includes('.firebase/')
    ) {
      continue;
    }
    if (i === 0 && rel.includes('/')) {
      rootFolderName = rel.split('/')[0];
    }
    if (
      /\.(ts|tsx|js|jsx|mjs|py|json|css|html)$/.test(f.name) &&
      f.name !== 'package-lock.json'
    ) {
      const content = await f.text();
      const relPath = (f.webkitRelativePath || f.name).replace(/^[^/]+\//, '');
      virtualFiles.push({
        relPath,
        name: f.name,
        content,
      });
    }
  }

  return buildGalaxyFromVirtualFiles(rootFolderName, virtualFiles);
}
