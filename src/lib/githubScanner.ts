import { GalaxyLink, GalaxyNode } from '../data/galaxyTypes';
import { buildGalaxyFromVirtualFiles, VirtualSourceFile } from './folderScanner';

export interface GitHubProgress {
  stage: string;
  loaded: number;
  total: number;
}

export const SAMPLE_GITHUB_REPOS = [
  {
    label: 'reupanacc-sudo/codebase-galaxy-3d',
    url: 'https://github.com/reupanacc-sudo/codebase-galaxy-3d',
    desc: 'Visualize this 3D Codebase Galaxy app itself!',
  },
  {
    label: 'pmndrs/zustand',
    url: 'https://github.com/pmndrs/zustand',
    desc: 'Bear necessities for state management in React (TypeScript)',
  },
  {
    label: 'lukeed/clsx',
    url: 'https://github.com/lukeed/clsx',
    desc: 'Tiny utility for constructing className strings',
  },
  {
    label: 'ai/nanoid',
    url: 'https://github.com/ai/nanoid',
    desc: 'Tiny, secure, URL-friendly unique string ID generator',
  },
  {
    label: 'developit/mitt',
    url: 'https://github.com/developit/mitt',
    desc: 'Tiny 200b functional event emitter / pubsub',
  },
];

export function parseGitHubInput(input: string): {
  owner: string;
  repo: string;
  branch?: string;
  subPath?: string;
} | null {
  const cleaned = input.trim().replace(/\/+$/, '').replace(/\.git$/, '');
  if (!cleaned) return null;

  // Match https://github.com/owner/repo(/tree/branch/subpath)?
  const urlMatch = cleaned.match(
    /(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/]+)(?:\/tree\/([^/]+)(?:\/(.*))?)?/i
  );
  if (urlMatch) {
    return {
      owner: urlMatch[1],
      repo: urlMatch[2],
      branch: urlMatch[3],
      subPath: urlMatch[4],
    };
  }

  // Match shorthand owner/repo
  const shortMatch = cleaned.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/);
  if (shortMatch) {
    return {
      owner: shortMatch[1],
      repo: shortMatch[2],
    };
  }

  return null;
}

export async function scanGitHubRepository(
  rawUrlOrSlug: string,
  onProgress?: (p: GitHubProgress) => void
): Promise<{
  projectName: string;
  nodes: GalaxyNode[];
  links: GalaxyLink[];
}> {
  const parsed = parseGitHubInput(rawUrlOrSlug);
  if (!parsed) {
    throw new Error('Invalid GitHub URL. Use format: https://github.com/owner/repo or owner/repo');
  }

  const { owner, repo, subPath } = parsed;
  let branch = parsed.branch;

  onProgress?.({ stage: `Connecting to GitHub (${owner}/${repo})...`, loaded: 0, total: 1 });

  // 1. Discover default branch if not provided
  if (!branch) {
    const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
    if (!repoRes.ok) {
      if (repoRes.status === 404) {
        throw new Error(`Repository "${owner}/${repo}" not found or is private.`);
      }
      if (repoRes.status === 403) {
        // Fallback to trying 'main' then 'master'
        branch = 'main';
      } else {
        throw new Error(`GitHub API error (${repoRes.status})`);
      }
    } else {
      const repoData = await repoRes.json();
      branch = repoData.default_branch || 'main';
    }
  }

  onProgress?.({ stage: `Fetching repository file tree (${branch})...`, loaded: 0, total: 1 });

  // 2. Fetch recursive git tree
  let treeRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`
  );
  if (!treeRes.ok && branch === 'main') {
    branch = 'master';
    treeRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`
    );
  }
  if (!treeRes.ok) {
    throw new Error(
      `Could not load file tree for ${owner}/${repo} (${treeRes.status}). Check if repo is public.`
    );
  }

  const treeJson = await treeRes.json();
  const treeItems: { path: string; type: string; size?: number }[] = treeJson.tree || [];

  // Filter to relevant source code files
  const candidateFiles = treeItems.filter((item) => {
    if (item.type !== 'blob') return false;
    const p = item.path;
    if (subPath && !p.startsWith(subPath)) return false;
    if (
      p.includes('node_modules/') ||
      p.includes('dist/') ||
      p.includes('build/') ||
      p.includes('.min.') ||
      p.includes('vendor/') ||
      p.includes('__snapshots__/') ||
      p.endsWith('package-lock.json') ||
      p.endsWith('pnpm-lock.yaml') ||
      p.endsWith('yarn.lock')
    ) {
      return false;
    }
    if ((item.size || 0) > 180_000) return false; // skip huge generated bundles
    return /\.(ts|tsx|js|jsx|mjs|py|go|rs|json|css)$/.test(p);
  });

  // Prioritize src/ files and non-test files first, cap at 55 files for fast live 3D rendering
  candidateFiles.sort((a, b) => {
    const aIsSrc = a.path.startsWith('src/') ? 0 : 1;
    const bIsSrc = b.path.startsWith('src/') ? 0 : 1;
    if (aIsSrc !== bIsSrc) return aIsSrc - bIsSrc;
    const aIsTest = /\.(test|spec)\./.test(a.path) || a.path.includes('tests/') ? 1 : 0;
    const bIsTest = /\.(test|spec)\./.test(b.path) || b.path.includes('tests/') ? 1 : 0;
    return aIsTest - bIsTest;
  });

  const selectedFiles = candidateFiles.slice(0, 55);
  if (selectedFiles.length === 0) {
    throw new Error(`No supported source files (.ts, .tsx, .js, .py, .json) found in ${owner}/${repo}.`);
  }

  const virtualFiles: VirtualSourceFile[] = [];
  let loadedCount = 0;
  const total = selectedFiles.length;

  // 3. Download raw file contents in parallel batches of 8 via raw.githubusercontent.com
  const batchSize = 8;
  for (let i = 0; i < selectedFiles.length; i += batchSize) {
    const batch = selectedFiles.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (item) => {
        try {
          const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${item.path}`;
          const res = await fetch(rawUrl);
          if (res.ok) {
            const content = await res.text();
            const parts = item.path.split('/');
            virtualFiles.push({
              relPath: item.path,
              name: parts[parts.length - 1],
              content,
            });
          }
        } catch {
          // Ignore individual file network hiccup
        } finally {
          loadedCount++;
          onProgress?.({
            stage: `Downloading & parsing source files (${loadedCount}/${total})...`,
            loaded: loadedCount,
            total,
          });
        }
      })
    );
  }

  onProgress?.({
    stage: `Building 3D galaxy & function call graph...`,
    loaded: total,
    total,
  });

  return buildGalaxyFromVirtualFiles(`${owner}/${repo}`, virtualFiles);
}
