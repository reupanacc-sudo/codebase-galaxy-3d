# 🌌 Codebase Galaxy 3D — Interactive Code Architecture & Call-Graph Visualizer

**Codebase Galaxy 3D** is a zero-backend, WebGL-powered 3D code architecture visualizer built with **React**, **TypeScript**, **Three.js**, and **Tailwind CSS**. It transforms any codebase—either a **local project folder** or **any public GitHub repository URL**—into an interactive 3D galaxy.

---

## ✨ Key Features

1. **🪐 3D Cosmic Dandelion Hierarchy**
   - **Central Nucleus & Architecture Clusters:** Files and directories radiate out in color-coded 3D branches.
   - **Dandelion Leaf Spheres:** Functions (`fn()`), React state hooks (`useState`), `useMemo` hooks, TypeScript `interface` definitions, and schema `.properties` arrange around their parent file using a **3D Fibonacci Golden Spiral**.
   - **3 Spatial Layout Modes:** Switch dynamically between **Dandelion Galaxy**, **3D Pyramid Hierarchy**, and **Orbital Shells**.

2. **🔥 Code Health & Complexity Heatmap**
   - Computes an overall **Architecture Health Score (0–100)** and grade (`A`–`D`).
   - Color-codes nodes by complexity:
     - 🟢 **Emerald:** Clean, modular files & symbols
     - 🟡 **Amber:** Moderate file size (`240–550` LOC) or hook density
     - 🔴 **Crimson Red:** Pulsing "God Files" (`>550` LOC or `>=10` state hooks)
     - 🟣 **Violet:** Unreferenced / orphan exported symbols
   - **Circular Dependency Detector:** Automatically detects circular import cycles via DFS and highlights them in pulsing crimson.

3. **⚡ Direct Function-Call Tracing & Multi-Hop Execution Chains**
   - Traces direct function-to-function calls across files and within modules.
   - Clicking any function or file lights up its **upstream callers (`Called By`)**, **downstream callees (`Calls`)**, and **multi-hop execution chains (`Caller() ➔ Handler() ➔ Utility()`)** with animated execution photons in 3D space.

4. **🌐 Visualize Any Public GitHub Repo or Local Folder**
   - **Paste GitHub URL:** Paste any public GitHub repository (`https://github.com/owner/repo` or `owner/repo`) to fetch and render its 3D galaxy directly in the browser.
   - **Scan Local Folder:** Select any local code directory on your machine (`webkitdirectory`)—100% client-side, no code ever leaves your browser.

---

## 🚀 Quick Start (Run Locally)

```bash
npm install
npm run dev
```

Then open **[http://localhost:5180](http://localhost:5180)** in your browser.
