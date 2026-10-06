import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GalaxyLink, GalaxyNode } from '../data/galaxyTypes';
import { CallChainTrace, CodeHealthReport, ColorMode } from '../lib/codeHealth';

export type LayoutMode = 'galaxy' | 'hierarchy' | 'orbital';

interface Props {
  nodes: GalaxyNode[];
  links: GalaxyLink[];
  selectedNode: GalaxyNode | null;
  onSelectNode: (node: GalaxyNode | null) => void;
  activeClusterFilter: string | null;
  activeKindFilter: string | null;
  searchQuery: string;
  autoRotate: boolean;
  showLabels: boolean;
  showParticles: boolean;
  showCallLinks: boolean;
  colorMode: ColorMode;
  healthReport: CodeHealthReport;
  callChainTrace: CallChainTrace;
  spreadFactor: number;
  dandelionRadius: number;
  layoutMode: LayoutMode;
  resetCameraTrigger: number;
}

interface PositionedNode extends GalaxyNode {
  x: number;
  y: number;
  z: number;
  baseX: number;
  baseY: number;
  baseZ: number;
  phase: number;
}

// Create a soft glowing radial sprite texture for nodes
function createGlowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.22, 'rgba(255, 255, 255, 0.92)');
  gradient.addColorStop(0.48, 'rgba(255, 255, 255, 0.35)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

// Create a 3D floating text sprite for major hubs & files
function createLabelSprite(text: string, colorHex: string, isMajor: boolean): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const fontSize = isMajor ? 34 : 26;
  ctx.font = `600 ${fontSize}px "Plus Jakarta Sans", "Inter", sans-serif`;
  const textWidth = ctx.measureText(text).width;

  canvas.width = Math.ceil(textWidth + 48);
  canvas.height = fontSize + 28;

  ctx.font = `600 ${fontSize}px "Plus Jakarta Sans", "Inter", sans-serif`;
  ctx.fillStyle = 'rgba(2, 6, 18, 0.82)';
  const r = 12;
  ctx.beginPath();
  ctx.roundRect(4, 4, canvas.width - 8, canvas.height - 8, r);
  ctx.fill();

  ctx.strokeStyle = colorHex;
  ctx.lineWidth = isMajor ? 2.5 : 1.4;
  ctx.stroke();

  ctx.fillStyle = isMajor ? '#ffffff' : colorHex;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });

  const sprite = new THREE.Sprite(material);
  const scaleFactor = isMajor ? 0.22 : 0.15;
  sprite.scale.set(canvas.width * scaleFactor, canvas.height * scaleFactor, 1);
  return sprite;
}

// Compute 3D positions that form the Cosmic Dandelion Galaxy, 3D Tree, or Orbital Shells
function compute3DPositions(
  nodes: GalaxyNode[],
  links: GalaxyLink[],
  layoutMode: LayoutMode,
  spreadFactor: number,
  dandelionRadius: number
): Map<string, PositionedNode> {
  const posMap = new Map<string, PositionedNode>();

  const childrenByParent = new Map<string, GalaxyNode[]>();
  const parentByChild = new Map<string, string>();
  const nodeById = new Map<string, GalaxyNode>();

  for (const n of nodes) {
    nodeById.set(n.id, n);
  }

  for (const l of links) {
    if (l.kind === 'dandelion' || l.kind === 'hierarchy') {
      if (!parentByChild.has(l.target)) {
        parentByChild.set(l.target, l.source);
        const list = childrenByParent.get(l.source) || [];
        const targetNode = nodeById.get(l.target);
        if (targetNode) list.push(targetNode);
        childrenByParent.set(l.source, list);
      }
    }
  }

  const hashStr = (str: string): number => {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967295;
  };

  // 1. Place Root Node at (0, 0, 0)
  const rootNode = nodes.find((n) => n.kind === 'root') || nodes[0];
  if (rootNode) {
    posMap.set(rootNode.id, {
      ...rootNode,
      x: 0,
      y: 0,
      z: 0,
      baseX: 0,
      baseY: 0,
      baseZ: 0,
      phase: 0,
    });
  }

  // Group files by cluster so clusters radiate out in distinct 3D directions
  const clusterIds = Array.from(new Set(nodes.map((n) => n.clusterId)));
  const clusterDirection = new Map<string, THREE.Vector3>();

  clusterIds.forEach((cid, idx) => {
    const phi = Math.acos(1 - (2 * (idx + 0.5)) / Math.max(1, clusterIds.length));
    const theta = Math.PI * (1 + Math.sqrt(5)) * idx;
    const dir = new THREE.Vector3(
      Math.sin(phi) * Math.cos(theta),
      Math.sin(phi) * Math.sin(theta),
      Math.cos(phi)
    ).normalize();
    clusterDirection.set(cid, dir);
  });

  // 2. Place Folders & Files first
  const fileAndFolderNodes = nodes.filter((n) => n.kind === 'folder' || n.kind === 'file');
  fileAndFolderNodes.forEach((node, idx) => {
    const h1 = hashStr(node.id + ':a');
    const h2 = hashStr(node.id + ':b');
    const h3 = hashStr(node.id + ':c');
    const cDir = clusterDirection.get(node.clusterId) || new THREE.Vector3(1, 0, 0);

    let x = 0,
      y = 0,
      z = 0;

    if (layoutMode === 'galaxy') {
      const isCoreFile = node.label === 'App.tsx' || node.label === 'main.tsx';
      const baseDist = isCoreFile
        ? 38 * spreadFactor
        : node.kind === 'folder'
        ? (95 + h1 * 45) * spreadFactor
        : (170 + h1 * 240) * spreadFactor;

      const jitter = new THREE.Vector3((h1 - 0.5) * 1.15, (h2 - 0.5) * 1.15, (h3 - 0.5) * 1.15);
      const finalDir = cDir.clone().add(jitter).normalize();

      x = finalDir.x * baseDist;
      y = finalDir.y * baseDist;
      z = finalDir.z * baseDist;
    } else if (layoutMode === 'hierarchy') {
      const layerY = node.kind === 'folder' ? 90 : -20 - (idx % 3) * 80;
      const angle = (idx / Math.max(1, fileAndFolderNodes.length)) * Math.PI * 2;
      const radius = (node.kind === 'folder' ? 110 : 240 + (h1 - 0.5) * 80) * spreadFactor;
      x = Math.cos(angle) * radius;
      y = layerY * spreadFactor;
      z = Math.sin(angle) * radius;
    } else {
      const phi = Math.acos(1 - (2 * (idx + 0.5)) / Math.max(1, fileAndFolderNodes.length));
      const theta = Math.PI * (1 + Math.sqrt(5)) * idx;
      const r = (node.kind === 'folder' ? 110 : 240) * spreadFactor;
      x = r * Math.sin(phi) * Math.cos(theta);
      y = r * Math.sin(phi) * Math.sin(theta);
      z = r * Math.cos(phi);
    }

    posMap.set(node.id, {
      ...node,
      x,
      y,
      z,
      baseX: x,
      baseY: y,
      baseZ: z,
      phase: h1 * Math.PI * 2,
    });
  });

  // 3. Place secondary sub-hubs (interfaces & state sub-hubs) branching out from their parent file
  const subHubNodes = nodes.filter(
    (n) => n.kind === 'interface' || (n.kind === 'hook' && n.id.startsWith('subhub:'))
  );
  subHubNodes.forEach((sub, idx) => {
    const parentId = parentByChild.get(sub.id) || rootNode?.id || '';
    const parentPos = posMap.get(parentId) || { x: 0, y: 0, z: 0 };
    const h1 = hashStr(sub.id + ':x');
    const h2 = hashStr(sub.id + ':y');
    const h3 = hashStr(sub.id + ':z');

    const outward = new THREE.Vector3(parentPos.x, parentPos.y, parentPos.z);
    if (outward.lengthSq() < 1) outward.set(1, 0, 0);
    outward.normalize();

    const offsetDir = outward
      .clone()
      .add(new THREE.Vector3((h1 - 0.5) * 1.6, (h2 - 0.5) * 1.6, (h3 - 0.5) * 1.6))
      .normalize();

    const branchDist = (65 + h1 * 55) * spreadFactor;
    const x = parentPos.x + offsetDir.x * branchDist;
    const y = parentPos.y + offsetDir.y * branchDist;
    const z = parentPos.z + offsetDir.z * branchDist;

    posMap.set(sub.id, {
      ...sub,
      x,
      y,
      z,
      baseX: x,
      baseY: y,
      baseZ: z,
      phase: (idx * 0.7) % (Math.PI * 2),
    });
  });

  // 4. Place all Dandelion Leaf Nodes around their parent hub in lush 3D Fibonacci spheres
  for (const [parentId, children] of childrenByParent.entries()) {
    const parentPos = posMap.get(parentId);
    if (!parentPos) continue;

    const leafChildren = children.filter((c) => !posMap.has(c.id));
    const count = leafChildren.length;
    if (count === 0) continue;

    const puffRadius = Math.max(16, Math.min(44, 14 + Math.sqrt(count) * 4.8)) * dandelionRadius;

    leafChildren.forEach((leaf, i) => {
      const phi = Math.acos(1 - (2 * (i + 0.5)) / Math.max(1, count));
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      const rJitter = puffRadius * (0.72 + hashStr(leaf.id) * 0.42);

      const lx = parentPos.x + rJitter * Math.sin(phi) * Math.cos(theta);
      const ly = parentPos.y + rJitter * Math.sin(phi) * Math.sin(theta);
      const lz = parentPos.z + rJitter * Math.cos(phi);

      posMap.set(leaf.id, {
        ...leaf,
        x: lx,
        y: ly,
        z: lz,
        baseX: lx,
        baseY: ly,
        baseZ: lz,
        phase: hashStr(leaf.id) * Math.PI * 2,
      });
    });
  }

  for (const n of nodes) {
    if (!posMap.has(n.id)) {
      const h1 = hashStr(n.id + '1');
      const h2 = hashStr(n.id + '2');
      const h3 = hashStr(n.id + '3');
      const x = (h1 - 0.5) * 300;
      const y = (h2 - 0.5) * 300;
      const z = (h3 - 0.5) * 300;
      posMap.set(n.id, { ...n, x, y, z, baseX: x, baseY: y, baseZ: z, phase: 0 });
    }
  }

  return posMap;
}

export const GalaxyCanvas3D: React.FC<Props> = ({
  nodes,
  links,
  selectedNode,
  onSelectNode,
  activeClusterFilter,
  activeKindFilter,
  searchQuery,
  autoRotate,
  showLabels,
  showParticles,
  showCallLinks,
  colorMode,
  healthReport,
  callChainTrace,
  spreadFactor,
  dandelionRadius,
  layoutMode,
  resetCameraTrigger,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [hoveredNode, setHoveredNode] = useState<{
    node: GalaxyNode;
    screenX: number;
    screenY: number;
  } | null>(null);

  const selectedNodeRef = useRef<GalaxyNode | null>(selectedNode);
  selectedNodeRef.current = selectedNode;

  const autoRotateRef = useRef(autoRotate);
  autoRotateRef.current = autoRotate;

  const showParticlesRef = useRef(showParticles);
  showParticlesRef.current = showParticles;

  const cameraTargetLerpRef = useRef<{
    active: boolean;
    camPos: THREE.Vector3;
    lookAt: THREE.Vector3;
  }>({
    active: false,
    camPos: new THREE.Vector3(0, 80, 560),
    lookAt: new THREE.Vector3(0, 0, 0),
  });

  const posMapRef = useRef<Map<string, PositionedNode>>(new Map());

  // Fly camera when selectedNode changes
  useEffect(() => {
    if (!selectedNode) return;
    const p = posMapRef.current.get(selectedNode.id);
    if (!p) return;

    const targetLook = new THREE.Vector3(p.x, p.y, p.z);
    const dir = targetLook.clone();
    if (dir.lengthSq() < 1) dir.set(0, 0.3, 1);
    dir.normalize();

    const dist =
      selectedNode.kind === 'root'
        ? 380
        : selectedNode.kind === 'file' || selectedNode.kind === 'interface'
        ? 145
        : 95;
    const camDest = targetLook
      .clone()
      .add(dir.multiplyScalar(dist))
      .add(new THREE.Vector3(0, 25, 0));

    cameraTargetLerpRef.current = {
      active: true,
      camPos: camDest,
      lookAt: targetLook,
    };
  }, [selectedNode]);

  // Reset camera when requested
  useEffect(() => {
    if (resetCameraTrigger === 0) return;
    cameraTargetLerpRef.current = {
      active: true,
      camPos: new THREE.Vector3(0, 90, 580),
      lookAt: new THREE.Vector3(0, 0, 0),
    };
  }, [resetCameraTrigger]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#02040a');
    scene.fog = new THREE.FogExp2('#02040a', 0.00055);

    const camera = new THREE.PerspectiveCamera(55, width / height, 1, 4000);
    camera.position.set(0, 90, 580);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.rotateSpeed = 0.65;
    controls.zoomSpeed = 0.9;
    controls.minDistance = 20;
    controls.maxDistance = 1800;

    const stopLerp = () => {
      cameraTargetLerpRef.current.active = false;
    };
    controls.addEventListener('start', stopLerp);

    // 1. Ambient Deep Space Starfield
    const starCount = 1400;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = 900 + Math.random() * 1100;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      starPositions[i * 3 + 2] = r * Math.cos(phi);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0x64748b,
      size: 2.2,
      transparent: true,
      opacity: 0.45,
    });
    const starField = new THREE.Points(starGeo, starMat);
    scene.add(starField);

    // 2. Compute 3D Galaxy Node Positions
    const posMap = compute3DPositions(nodes, links, layoutMode, spreadFactor, dandelionRadius);
    posMapRef.current = posMap;

    // Helper for effective node color based on ColorMode
    const getNodeDisplayColor = (n: GalaxyNode): string => {
      if (colorMode === 'heatmap') {
        const m = healthReport.nodeMetrics.get(n.id);
        return m ? m.heatColor : n.color;
      }
      if (colorMode === 'calls') {
        if (callChainTrace.chainNodeIds.has(n.id)) return '#38bdf8';
        if (n.kind === 'function' || n.kind === 'hook') return '#fbbf24';
        if (n.kind === 'file') return '#64748b';
        return '#334155';
      }
      return n.color;
    };

    const q = searchQuery.trim().toLowerCase();
    const isNodeVisible = (n: GalaxyNode): boolean => {
      if (activeClusterFilter && n.clusterId !== activeClusterFilter && n.kind !== 'root')
        return false;
      if (activeKindFilter && n.kind !== activeKindFilter && n.kind !== 'root') return false;
      if (q) {
        const match =
          n.label.toLowerCase().includes(q) ||
          n.filePath.toLowerCase().includes(q) ||
          n.clusterName.toLowerCase().includes(q) ||
          n.description.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    };

    // Determine neighbors + multi-hop call chain of selected node for spotlighting
    const connectedIds = new Set<string>();
    if (selectedNode) {
      connectedIds.add(selectedNode.id);
      for (const id of callChainTrace.chainNodeIds) {
        connectedIds.add(id);
      }
      for (const l of links) {
        if (!showCallLinks && colorMode !== 'calls' && l.kind === 'call' && !callChainTrace.chainEdgeKeys.has(`${l.source}->${l.target}`)) {
          continue;
        }
        if (l.source === selectedNode.id) connectedIds.add(l.target);
        if (l.target === selectedNode.id) connectedIds.add(l.source);
      }
    }

    // 3. Filter active links (include 'call' links if showCallLinks, colorMode==='calls', or part of selected trace)
    const validLinks = links.filter((l) => {
      if (!posMap.has(l.source) || !posMap.has(l.target)) return false;
      if (l.kind === 'call') {
        const inActiveChain = callChainTrace.chainEdgeKeys.has(`${l.source}->${l.target}`);
        return showCallLinks || colorMode === 'calls' || inActiveChain;
      }
      return true;
    });

    const linePositions = new Float32Array(validLinks.length * 6);
    const lineColors = new Float32Array(validLinks.length * 6);

    validLinks.forEach((l, idx) => {
      const s = posMap.get(l.source)!;
      const t = posMap.get(l.target)!;

      linePositions[idx * 6] = s.x;
      linePositions[idx * 6 + 1] = s.y;
      linePositions[idx * 6 + 2] = s.z;
      linePositions[idx * 6 + 3] = t.x;
      linePositions[idx * 6 + 4] = t.y;
      linePositions[idx * 6 + 5] = t.z;

      const sVis = isNodeVisible(s);
      const tVis = isNodeVisible(t);
      const edgeKey = `${l.source}->${l.target}`;
      const isCallChainEdge = callChainTrace.chainEdgeKeys.has(edgeKey);
      const isCircularEdge =
        l.kind === 'circular' || healthReport.circularEdgeKeys.has(edgeKey);
      const isDirectTouch =
        selectedNode && (l.source === selectedNode.id || l.target === selectedNode.id);
      const isHighlighted = isDirectTouch || isCallChainEdge;

      let dimFactor =
        sVis && tVis
          ? l.kind === 'call'
            ? 0.72
            : l.kind === 'dandelion'
            ? 0.52
            : 0.42
          : 0.05;

      if (colorMode === 'calls' && l.kind !== 'call') {
        dimFactor *= 0.25;
      }

      if (selectedNode) {
        dimFactor = isHighlighted ? 0.98 : 0.06;
      }

      let sHex = getNodeDisplayColor(s);
      let tHex = getNodeDisplayColor(t);

      if (isCircularEdge && (colorMode === 'heatmap' || isHighlighted)) {
        sHex = '#f43f5e';
        tHex = '#ef4444';
        dimFactor = Math.max(dimFactor, 0.95);
      } else if (l.kind === 'call') {
        sHex = isCallChainEdge ? '#38bdf8' : '#f59e0b';
        tHex = isCallChainEdge ? '#fbbf24' : '#38bdf8';
      } else if (isHighlighted) {
        sHex = '#ffffff';
      }

      const cS = new THREE.Color(sHex).multiplyScalar(dimFactor);
      const cT = new THREE.Color(tHex).multiplyScalar(dimFactor);

      lineColors[idx * 6] = cS.r;
      lineColors[idx * 6 + 1] = cS.g;
      lineColors[idx * 6 + 2] = cS.b;
      lineColors[idx * 6 + 3] = cT.r;
      lineColors[idx * 6 + 4] = cT.g;
      lineColors[idx * 6 + 5] = cT.b;
    });

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    lineGeo.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));

    const lineMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.82,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const lineSegments = new THREE.LineSegments(lineGeo, lineMat);
    scene.add(lineSegments);

    // 4. Build Glowing Node Sprites & Raycast Targets
    const glowTex = createGlowTexture();
    const nodeGroup = new THREE.Group();
    const labelGroup = new THREE.Group();
    const interactiveMeshes: THREE.Object3D[] = [];
    const pulsingHalos: { sprite: THREE.Sprite; baseScale: number; phase: number }[] = [];

    const sphereGeo = new THREE.SphereGeometry(1, 16, 16);

    for (const pNode of posMap.values()) {
      const visible = isNodeVisible(pNode);
      const isSelected = selectedNode?.id === pNode.id;
      const isCallChainMember = callChainTrace.chainNodeIds.has(pNode.id);
      const isNeighbor = selectedNode ? connectedIds.has(pNode.id) : true;
      const metric = healthReport.nodeMetrics.get(pNode.id);
      const isHotspot =
        colorMode === 'heatmap' &&
        metric &&
        (metric.status === 'critical' || metric.status === 'circular');

      let alpha = visible ? 1 : 0.08;
      if (selectedNode && !isNeighbor) {
        alpha = Math.min(alpha, 0.12);
      }

      const displayColorHex = getNodeDisplayColor(pNode);
      const color = new THREE.Color(displayColorHex);

      // Solid inner sphere for crisp raycasting & 3D depth
      const meshMat = new THREE.MeshBasicMaterial({
        color: isSelected ? new THREE.Color('#ffffff') : color,
        transparent: true,
        opacity: alpha,
      });
      const mesh = new THREE.Mesh(sphereGeo, meshMat);
      const sizeBoost = isHotspot ? 1.25 : isCallChainMember ? 1.2 : 1.0;
      const coreScale = pNode.size * sizeBoost * (isSelected ? 0.72 : 0.45);
      mesh.scale.set(coreScale, coreScale, coreScale);
      mesh.position.set(pNode.x, pNode.y, pNode.z);
      mesh.userData = { galaxyNode: pNode };
      nodeGroup.add(mesh);
      interactiveMeshes.push(mesh);

      // Additive outer glow halo sprite
      const spriteMat = new THREE.SpriteMaterial({
        map: glowTex,
        color: isSelected
          ? new THREE.Color('#38bdf8')
          : isCallChainMember && selectedNode
          ? new THREE.Color('#fbbf24')
          : color,
        transparent: true,
        opacity: alpha * (isSelected || isCallChainMember ? 1.0 : 0.78),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const halo = new THREE.Sprite(spriteMat);
      const haloScale =
        pNode.size * sizeBoost * (isSelected ? 4.4 : isCallChainMember ? 3.4 : 2.5);
      halo.scale.set(haloScale, haloScale, 1);
      halo.position.set(pNode.x, pNode.y, pNode.z);
      nodeGroup.add(halo);

      if (isHotspot || isSelected || isCallChainMember) {
        pulsingHalos.push({
          sprite: halo,
          baseScale: haloScale,
          phase: pNode.phase,
        });
      }

      // Floating 3D label for Root, Folders, Files, Interfaces, Call-Chain nodes, or Selected/Searched nodes
      const shouldShowLabel =
        showLabels &&
        visible &&
        (pNode.kind === 'root' ||
          pNode.kind === 'folder' ||
          pNode.kind === 'file' ||
          pNode.kind === 'interface' ||
          isSelected ||
          (selectedNode && isCallChainMember) ||
          (q.length > 1 && visible));

      if (shouldShowLabel && (!selectedNode || isNeighbor)) {
        const isMajor =
          pNode.kind === 'root' ||
          pNode.kind === 'file' ||
          pNode.kind === 'folder' ||
          Boolean(selectedNode && isCallChainMember);
        const labelText =
          colorMode === 'heatmap' && pNode.kind === 'file'
            ? `${pNode.label} (${pNode.lines}L)`
            : pNode.label;
        const labelSprite = createLabelSprite(labelText, displayColorHex, isMajor);
        labelSprite.position.set(pNode.x, pNode.y + pNode.size * 0.9 + 6, pNode.z);
        labelGroup.add(labelSprite);
      }
    }

    scene.add(nodeGroup);
    scene.add(labelGroup);

    // 5. Animated Data-Flow & Function-Call Photon Particles
    const flowLinks = validLinks.filter((l) => {
      if (selectedNode && callChainTrace.chainEdgeKeys.size > 0) {
        return (
          callChainTrace.chainEdgeKeys.has(`${l.source}->${l.target}`) ||
          l.source === selectedNode.id ||
          l.target === selectedNode.id
        );
      }
      return l.kind === 'import' || l.kind === 'hierarchy' || l.kind === 'call';
    });

    const particleCount = flowLinks.length * 2;
    const particlePositions = new Float32Array(particleCount * 3);
    const particleColors = new Float32Array(particleCount * 3);
    const particleOffsets = new Float32Array(particleCount);
    const particleSpeeds = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
      particleOffsets[i] = Math.random();
      const link = flowLinks[Math.floor(i / 2)];
      const edgeKey = `${link.source}->${link.target}`;
      const isCall = link.kind === 'call' || callChainTrace.chainEdgeKeys.has(edgeKey);
      particleSpeeds[i] = isCall ? 1.65 : i % 2 === 0 ? 0.95 : 0.65;

      const s = posMap.get(link.source)!;
      const c = new THREE.Color(
        isCall ? '#fbbf24' : getNodeDisplayColor(s)
      );
      particleColors[i * 3] = c.r;
      particleColors[i * 3 + 1] = c.g;
      particleColors[i * 3 + 2] = c.b;
    }

    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    particleGeo.setAttribute('color', new THREE.BufferAttribute(particleColors, 3));

    const particleMat = new THREE.PointsMaterial({
      size: selectedNode ? 7.2 : 5.8,
      map: glowTex,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const particleSystem = new THREE.Points(particleGeo, particleMat);
    scene.add(particleSystem);

    // 6. Raycaster for Hover & Click Selection
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerDownPos = { x: 0, y: 0 };

    const handlePointerMove = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(pointer, camera);
      const intersects = raycaster.intersectObjects(interactiveMeshes, false);

      if (intersects.length > 0) {
        const hitNode = intersects[0].object.userData.galaxyNode as GalaxyNode;
        renderer.domElement.style.cursor = 'pointer';
        setHoveredNode({
          node: hitNode,
          screenX: e.clientX - rect.left,
          screenY: e.clientY - rect.top,
        });
      } else {
        renderer.domElement.style.cursor = 'grab';
        setHoveredNode(null);
      }
    };

    const handlePointerDown = (e: MouseEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };

    const handlePointerUp = (e: MouseEvent) => {
      const dx = e.clientX - pointerDownPos.x;
      const dy = e.clientY - pointerDownPos.y;
      if (Math.hypot(dx, dy) > 6) return;

      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(pointer, camera);
      const intersects = raycaster.intersectObjects(interactiveMeshes, false);

      if (intersects.length > 0) {
        const hitNode = intersects[0].object.userData.galaxyNode as GalaxyNode;
        onSelectNode(hitNode);
      } else {
        onSelectNode(null);
      }
    };

    renderer.domElement.addEventListener('mousemove', handlePointerMove);
    renderer.domElement.addEventListener('mousedown', handlePointerDown);
    renderer.domElement.addEventListener('mouseup', handlePointerUp);

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // 7. Animation Loop
    let frameId = 0;
    let clock = 0;

    const animate = () => {
      frameId = requestAnimationFrame(animate);
      clock += 0.0045;

      // Pulse critical hotspots & call-chain halos
      for (const h of pulsingHalos) {
        const pulse = 1 + Math.sin(clock * 8 + h.phase) * 0.18;
        h.sprite.scale.set(h.baseScale * pulse, h.baseScale * pulse, 1);
      }

      if (cameraTargetLerpRef.current.active) {
        camera.position.lerp(cameraTargetLerpRef.current.camPos, 0.07);
        controls.target.lerp(cameraTargetLerpRef.current.lookAt, 0.08);
        if (camera.position.distanceTo(cameraTargetLerpRef.current.camPos) < 1.5) {
          cameraTargetLerpRef.current.active = false;
        }
      } else if (autoRotateRef.current && !selectedNodeRef.current) {
        const rotSpeed = 0.0018;
        const x = camera.position.x;
        const z = camera.position.z;
        camera.position.x = x * Math.cos(rotSpeed) - z * Math.sin(rotSpeed);
        camera.position.z = z * Math.cos(rotSpeed) + x * Math.sin(rotSpeed);
      }

      particleSystem.visible = showParticlesRef.current;
      if (showParticlesRef.current && flowLinks.length > 0) {
        const posAttr = particleGeo.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < particleCount; i++) {
          const t = (particleOffsets[i] + clock * particleSpeeds[i]) % 1;
          const link = flowLinks[Math.floor(i / 2)];
          const s = posMap.get(link.source)!;
          const d = posMap.get(link.target)!;

          posAttr.setXYZ(
            i,
            s.x + (d.x - s.x) * t,
            s.y + (d.y - s.y) * t,
            s.z + (d.z - s.z) * t
          );
        }
        posAttr.needsUpdate = true;
      }

      controls.update();
      renderer.render(scene, camera);
    };

    animate();

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('mousemove', handlePointerMove);
      renderer.domElement.removeEventListener('mousedown', handlePointerDown);
      renderer.domElement.removeEventListener('mouseup', handlePointerUp);
      controls.dispose();
      renderer.dispose();
    };
  }, [
    nodes,
    links,
    selectedNode,
    activeClusterFilter,
    activeKindFilter,
    searchQuery,
    showLabels,
    showCallLinks,
    colorMode,
    healthReport,
    callChainTrace,
    spreadFactor,
    dandelionRadius,
    layoutMode,
  ]);

  const hoveredMetric = hoveredNode ? healthReport.nodeMetrics.get(hoveredNode.node.id) : null;

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#02040a]">
      <div ref={mountRef} className="w-full h-full" />

      {/* Floating 3D Hover Tooltip */}
      {hoveredNode && (
        <div
          className="pointer-events-none absolute z-30 max-w-xs rounded-xl border border-slate-700/80 bg-slate-950/95 px-3.5 py-2.5 shadow-2xl backdrop-blur-md transition-transform duration-75"
          style={{
            left: Math.min(hoveredNode.screenX + 16, window.innerWidth - 320),
            top: Math.max(hoveredNode.screenY - 20, 16),
          }}
        >
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-full shrink-0 shadow-sm"
                style={{
                  backgroundColor:
                    colorMode === 'heatmap' && hoveredMetric
                      ? hoveredMetric.heatColor
                      : hoveredNode.node.color,
                  boxShadow: `0 0 10px ${
                    colorMode === 'heatmap' && hoveredMetric
                      ? hoveredMetric.heatColor
                      : hoveredNode.node.color
                  }`,
                }}
              />
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {hoveredNode.node.kind} • {hoveredNode.node.clusterName}
              </span>
            </div>
            {hoveredMetric && (
              <span
                className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase"
                style={{
                  backgroundColor: `${hoveredMetric.heatColor}22`,
                  color: hoveredMetric.heatColor,
                }}
              >
                {hoveredMetric.status}
              </span>
            )}
          </div>
          <div className="font-mono text-sm font-bold text-white break-all">
            {hoveredNode.node.label}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-400 line-clamp-2">
            {hoveredNode.node.description}
          </div>
          {hoveredMetric && (hoveredMetric.fanIn > 0 || hoveredMetric.fanOut > 0) && (
            <div className="mt-1.5 flex items-center gap-3 text-[10px] font-mono text-amber-300/90">
              <span>⚡ Calls Out: {hoveredMetric.fanOut}</span>
              <span>📡 Called By: {hoveredMetric.fanIn}</span>
            </div>
          )}
          <div className="mt-1.5 text-[10px] font-medium text-sky-400">
            Click to fly camera, trace call chain &amp; inspect code →
          </div>
        </div>
      )}
    </div>
  );
};
