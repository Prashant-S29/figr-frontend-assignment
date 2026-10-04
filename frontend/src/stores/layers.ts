// Owns per-preview lazy Layers state, live level replacement, derived search, row attempts and panel lifetimes; agents own DOM reads and React only renders snapshots.
import type { AgentMessage, HostMessage, Target, TreeLevel, TreeNode } from "../../../shared/protocol";
import { runAttempt, type Attempt } from "../core/attempt";
import { registerDevTrigger } from "../core/dev-registry";
import type { FailureTarget } from "../core/fail";
import { guard } from "../core/guard";
import { scopedTimeout } from "../core/schedule";
import { createFailureRegion, type FailureRegion } from "./failure-region";
import { nearestVisibleRow, replaceTreeLevels, searchTree, visibleTreeRows } from "./layers-tree";
import type { SelectionStore } from "./selection";

export type RowLoadState =
  | { readonly kind: "loading"; readonly region: FailureRegion }
  | { readonly kind: "loaded"; readonly children: readonly string[] }
  | { readonly kind: "error"; readonly region: FailureRegion };

export interface LayersSnapshot {
  readonly revision: number;
  readonly screenId: string | null;
  readonly region: FailureRegion | null;
  readonly rootLoading: boolean;
  readonly roots: readonly string[];
  readonly nodes: ReadonlyMap<string, TreeNode>;
  readonly parents: ReadonlyMap<string, string | null>;
  readonly children: ReadonlyMap<string, readonly string[]>;
  readonly rows: ReadonlyMap<string, RowLoadState>;
  readonly expanded: ReadonlySet<string>;
  readonly selected: ReadonlySet<string>;
  readonly hoveredId: string | null;
  readonly focusedId: string | null;
  readonly scrollId: string | null;
  readonly scrollRevision: number;
  readonly renderError: Error | null;
  readonly query: string;
  readonly searchLoading: boolean;
  readonly searchPaths: readonly (readonly TreeNode[])[];
  readonly searchExpanded: ReadonlySet<string>;
  readonly beforeSearch: ReadonlySet<string> | null;
}

interface PendingChildren {
  readonly parentId: string | null;
  resolve(children: readonly TreeNode[]): void;
  reject(error: unknown): void;
  cancel(): void;
}

interface PendingAncestors {
  readonly elementId: string;
  resolve(path: readonly TreeNode[]): void;
  reject(error: unknown): void;
  cancel(): void;
}

interface RowOwner {
  readonly region: FailureRegion;
  readonly unsubscribe: () => void;
  promise: Promise<boolean> | null;
}

/** Creates one active-preview tree whose row requests remain isolated from the board, Inspector and sibling rows. */
export function createLayers(
  selection: SelectionStore,
  owner: () => FailureTarget,
  send: (screenId: string, message: HostMessage) => void,
  dev: boolean,
) {
  let snapshot: LayersSnapshot = emptySnapshot(0);
  let requestId = 0;
  let selectionToken = "";
  let revealVersion = 0;
  let hoverToken = "";
  let rootAttempt: Attempt | null = null;
  let rootPromise: Promise<boolean> | null = null;
  let revealAttempt: Attempt | null = null;
  let hoverAttempt: Attempt | null = null;
  let failNextParent: string | null = null;
  let skipNextParent: string | null = null;
  let skipNextSearch = false;
  let renderRetryError: Error | null = null;
  const readyScreens = new Set<string>();
  const remembered = new Map<string, LayersSnapshot>();
  const positions = new Map<string, { top: number; left: number }>();
  let searchRequest = 0;
  let cancelSearchDeadline: (() => void) | null = null;
  const rowOwners = new Map<string, RowOwner>();
  const pendingChildren = new Map<number, PendingChildren>();
  const pendingAncestors = new Map<number, PendingAncestors>();
  const listeners = new Set<() => void>();
  const removeTriggers: (() => void)[] = [];

  /** Builds an inactive immutable panel snapshot while retaining a monotonic render revision. */
  function emptySnapshot(revision: number): LayersSnapshot {
    return {
      revision,
      screenId: null,
      region: null,
      rootLoading: false,
      roots: [],
      nodes: new Map(),
      parents: new Map(),
      children: new Map(),
      rows: new Map(),
      expanded: new Set(),
      selected: new Set(),
      hoveredId: null,
      focusedId: null,
      scrollId: null,
      scrollRevision: 0,
      renderError: null,
      query: "",
      searchLoading: false,
      searchPaths: [],
      searchExpanded: new Set(),
      beforeSearch: null,
    };
  }

  /** Publishes a complete snapshot after store-owned maps and sets have been replaced. */
  function publish(next: LayersSnapshot): void {
    snapshot = next;
    for (const listener of listeners) listener();
  }

  /** Reads relationships in the shape shared by visible-row and nearest-ancestor derivations. */
  function relations() {
    return snapshot.query ? { ...searchTree(snapshot.searchPaths), expanded: snapshot.searchExpanded } : { roots: snapshot.roots, children: snapshot.children, parents: snapshot.parents, expanded: snapshot.expanded };
  }

  /** Cancels request/reveal work and disposes all child regions without touching the current whole-panel region. */
  function clearWork(): void {
    revealVersion += 1;
    cancelSearchDeadline?.();
    cancelSearchDeadline = null;
    searchRequest = 0;
    renderRetryError = null;
    failNextParent = skipNextParent = null;
    skipNextSearch = false;
    rootAttempt?.cancel();
    revealAttempt?.cancel();
    hoverAttempt?.cancel();
    rootAttempt = revealAttempt = hoverAttempt = null;
    rootPromise = null;
    for (const pending of pendingChildren.values()) pending.cancel();
    for (const pending of pendingAncestors.values()) pending.cancel();
    pendingChildren.clear();
    pendingAncestors.clear();
    for (const row of rowOwners.values()) {
      row.unsubscribe();
      row.region.dispose();
    }
    rowOwners.clear();
  }

  /** Cancels child/reveal work when the whole Layers fallback removes its visible rows. */
  function panelRegion(screenId: string): FailureRegion {
    const region = createFailureRegion("layers", { screenId }, owner().ctx.scope);
    /** Makes removed child attempts silent before any queued response or timeout can arrive. */
    function changed(): void {
      if (snapshot.region === region && region.getSnapshot().failure) clearWork();
    }
    region.subscribe(changed);
    return region;
  }

  /** Replaces the active preview's whole Layers owner, including page-instance-local ids and in-flight replies. */
  function activate(screenId: string | null, force = false): void {
    if (!force && snapshot.screenId === screenId) return;
    if (snapshot.screenId && !force) {
      const rows = new Map([...snapshot.rows].filter(([, state]) => state.kind === "loaded"));
      remembered.set(snapshot.screenId, { ...snapshot, rows, renderError: null });
      if (snapshot.query) send(snapshot.screenId, { type: "tree-search", requestId: ++requestId, query: "" });
    }
    clearWork();
    snapshot.region?.dispose();
    selectionToken = hoverToken = "";
    if (screenId === null) {
      publish(emptySnapshot(snapshot.revision + 1));
      return;
    }
    const region = panelRegion(screenId);
    const saved = !force ? remembered.get(screenId) : undefined;
    publish({ ...(saved ?? emptySnapshot(snapshot.revision + 1)), revision: snapshot.revision + 1, screenId, region, rootLoading: !saved && readyScreens.has(screenId), scrollId: null });
    if (readyScreens.has(screenId)) {
      loadRoot();
      watchTree();
      for (const id of snapshot.expanded) if (snapshot.nodes.get(id)?.hasChildren && !snapshot.rows.has(id)) loadRow(id);
      if (snapshot.query) requestSearch();
    }
  }

  /** Reuses one pending request per parent and attributes its three-second timeout to the supplied region. */
  function requestChildren(parentId: string | null, target: FailureTarget, signal: AbortSignal): Promise<readonly TreeNode[]> {
    if (parentId !== null && failNextParent === parentId) {
      failNextParent = null;
      return Promise.reject(new Error("Couldn't load"));
    }
    /** Registers one correlated child request and removes all native work before either settlement path. */
    function create(resolve: (children: readonly TreeNode[]) => void, reject: (error: unknown) => void): void {
      const correlation = ++requestId;
      let settled = false;
      /** Removes timeout and abort bookkeeping exactly once before settling the request. */
      function cleanup(): void {
        if (settled) return;
        settled = true;
        cancelTimeout();
        signal.removeEventListener("abort", abort);
        pendingChildren.delete(correlation);
      }
      /** Resolves only the matching live parent response. */
      function complete(children: readonly TreeNode[]): void { cleanup(); resolve(children); }
      /** Rejects malformed, timed-out or cancelled work under its original row owner. */
      function failRequest(error: unknown): void { cleanup(); reject(error); }
      /** Makes replaced row work silent through runAttempt's dead child scope. */
      function abort(): void { failRequest(new DOMException("Aborted", "AbortError")); }
      const cancelTimeout = scopedTimeout(target, () => failRequest(new Error("Couldn't load")), 3_000);
      pendingChildren.set(correlation, { parentId, resolve: complete, reject: failRequest, cancel: abort });
      signal.addEventListener("abort", abort, { once: true });
      if (parentId !== null && skipNextParent === parentId) skipNextParent = null;
      else send(snapshot.screenId!, { type: "tree-children", requestId: correlation, parentElementId: parentId });
    }
    return new Promise(create);
  }

  /** Correlates ancestor discovery separately from row loads so hover/reveal cancellation cannot consume a child reply. */
  function requestAncestors(elementId: string, target: FailureTarget, signal: AbortSignal): Promise<readonly TreeNode[]> {
    /** Registers one correlated ancestry request whose cancellation cannot consume a future selection's response. */
    function create(resolve: (path: readonly TreeNode[]) => void, reject: (error: unknown) => void): void {
      const correlation = ++requestId;
      let settled = false;
      /** Removes timeout and abort bookkeeping exactly once before settling the request. */
      function cleanup(): void {
        if (settled) return;
        settled = true;
        cancelTimeout();
        signal.removeEventListener("abort", abort);
        pendingAncestors.delete(correlation);
      }
      /** Resolves only a path ending at the requested current identity. */
      function complete(path: readonly TreeNode[]): void { cleanup(); resolve(path); }
      /** Rejects invalid, timed-out or cancelled discovery under the whole Layers owner. */
      function failRequest(error: unknown): void { cleanup(); reject(error); }
      /** Makes replaced selection discovery silent. */
      function abort(): void { failRequest(new DOMException("Aborted", "AbortError")); }
      const cancelTimeout = scopedTimeout(target, () => failRequest(new Error("Couldn't load")), 3_000);
      pendingAncestors.set(correlation, { elementId, resolve: complete, reject: failRequest, cancel: abort });
      signal.addEventListener("abort", abort, { once: true });
      send(snapshot.screenId!, { type: "tree-ancestors", requestId: correlation, elementId });
    }
    return new Promise(create);
  }

  /** Merges page-owned row metadata while deriving parent links only from a complete child level. */
  function applyChildren(parentId: string | null, values: readonly TreeNode[]): void {
    const nodes = new Map(snapshot.nodes);
    const parents = new Map(snapshot.parents);
    const children = new Map(snapshot.children);
    const ids = values.map(value => value.elementId);
    for (const value of values) {
      nodes.set(value.elementId, value);
      parents.set(value.elementId, parentId);
    }
    if (parentId !== null) children.set(parentId, ids);
    publish({ ...snapshot, nodes, parents, children, roots: parentId === null ? ids : snapshot.roots });
    watchTree();
  }

  /** Adds ancestor metadata and links without pretending that an unrequested sibling level is complete. */
  function applyPath(path: readonly TreeNode[]): void {
    const nodes = new Map(snapshot.nodes);
    const parents = new Map(snapshot.parents);
    for (let index = 0; index < path.length; index += 1) {
      const value = path[index];
      nodes.set(value.elementId, value);
      parents.set(value.elementId, index ? path[index - 1].elementId : null);
    }
    publish({ ...snapshot, nodes, parents });
  }

  /** Loads the invisible body root once and exposes failures through the whole Layers region. */
  function loadRoot(): Promise<boolean> {
    if (snapshot.roots.length || (rootPromise && rootAttempt)) return rootPromise ?? Promise.resolve(true);
    if (!snapshot.region || !snapshot.screenId || !readyScreens.has(snapshot.screenId)) return Promise.resolve(false);
    const region = snapshot.region;
    publish({ ...snapshot, rootLoading: true });
    /** Requests body children from this exact panel generation. */
    function load(signal: AbortSignal): Promise<readonly TreeNode[]> { return requestChildren(null, region.target, signal); }
    /** Publishes top-level rows only while this active panel still owns the response. */
    function apply(values: readonly TreeNode[]): void {
      if (snapshot.region !== region) return;
      applyChildren(null, values);
      publish({ ...snapshot, rootLoading: false });
    }
    rootAttempt = runAttempt(region.target, load, apply);
    rootPromise = rootAttempt.settled.then(() => snapshot.region === region && !region.getSnapshot().failure && !snapshot.rootLoading);
    return rootPromise;
  }

  /** Creates or reuses one row owner and mirrors its visible failure into the row's exact state. */
  function rowOwner(parentId: string): RowOwner {
    const existing = rowOwners.get(parentId);
    if (existing) return existing;
    const node = snapshot.nodes.get(parentId);
    const region = createFailureRegion("layers-row", { screenId: snapshot.screenId, ...(node?.dataKey !== null && node?.dataKey !== undefined ? { elementKey: node.dataKey } : {}) }, snapshot.region!.target.ctx.scope);
    /** Replaces Loading with Error only for this row while every sibling state remains untouched. */
    function changed(): void {
      const state = region.getSnapshot();
      if (!state.failure || snapshot.screenId === null) return;
      const rows = new Map(snapshot.rows);
      rows.set(parentId, { kind: "error", region });
      publish({ ...snapshot, rows });
    }
    const entry: RowOwner = { region, unsubscribe: region.subscribe(changed), promise: null };
    rowOwners.set(parentId, entry);
    return entry;
  }

  /** Starts at most one child attempt for a row and retains it across collapse/re-expand. */
  function loadRow(parentId: string): Promise<boolean> {
    const current = snapshot.rows.get(parentId);
    if (current?.kind === "loaded") return Promise.resolve(true);
    const entry = rowOwner(parentId);
    if (entry.promise) return entry.promise;
    const rows = new Map(snapshot.rows);
    rows.set(parentId, { kind: "loading", region: entry.region });
    publish({ ...snapshot, rows });
    /** Requests exactly one direct child level for this row. */
    function load(signal: AbortSignal): Promise<readonly TreeNode[]> { return requestChildren(parentId, entry.region.target, signal); }
    /** Atomically replaces Loading with one complete Loaded child list. */
    function apply(values: readonly TreeNode[]): void {
      applyChildren(parentId, values);
      const nextRows = new Map(snapshot.rows);
      nextRows.set(parentId, { kind: "loaded", children: values.map(value => value.elementId) });
      publish({ ...snapshot, rows: nextRows });
    }
    const attempt = runAttempt(entry.region.target, load, apply);
    entry.promise = attempt.settled.then(() => snapshot.rows.get(parentId)?.kind === "loaded");
    /** Releases only this completed attempt so a replacement generation keeps its own single-flight marker. */
    function finished(): void { if (rowOwners.get(parentId) === entry) entry.promise = null; }
    entry.promise.finally(finished);
    return entry.promise;
  }

  /** Loads either the body root or one parent row without duplicating an existing request. */
  function ensureLoaded(parentId: string | null): Promise<boolean> {
    return parentId === null ? loadRoot() : loadRow(parentId);
  }

  /** Reveals one body-relative path level by level, stopping if a mutation makes any requested relation stale. */
  async function revealPath(path: readonly TreeNode[], token: string, version: number, expanded: Set<string>): Promise<boolean> {
    if (!path.length || version !== revealVersion || selectionToken !== token) return false;
    applyPath(path);
    for (let index = 0; index < path.length; index += 1) {
      if (selectionToken !== token || version !== revealVersion || snapshot.screenId === null) return false;
      const parentId = index ? path[index - 1].elementId : null;
      if (!await ensureLoaded(parentId)) return false;
      const siblings = parentId === null ? snapshot.roots : snapshot.children.get(parentId) ?? [];
      if (!siblings.includes(path[index].elementId)) return false;
      if (index < path.length - 1) expanded.add(path[index].elementId);
    }
    return true;
  }

  /** Discovers selected paths in parallel, then expands each path while reusing shared ancestor row loads. */
  function reveal(targets: readonly Target[], token: string): void {
    revealAttempt?.cancel();
    if (!snapshot.region || !targets.length) return;
    const region = snapshot.region;
    const version = ++revealVersion;
    /** Requests all independent ancestor paths without a discovery waterfall. */
    function load(signal: AbortSignal): Promise<readonly (readonly TreeNode[])[]> {
      return Promise.all(targets.map(target => requestAncestors(target.elementId, region.target, signal)));
    }
    /** Expands current paths and scrolls only the most-recent selected row into the panel. */
    function apply(paths: readonly (readonly TreeNode[])[]): void {
      /** Loads shared ancestor levels, then publishes one atomic expansion and final panel scroll. */
      async function expandPaths(): Promise<void> {
        const expanded = new Set(snapshot.expanded);
        const results = await Promise.all(paths.map(path => revealPath(path, token, version, expanded)));
        if (snapshot.region !== region || selectionToken !== token || version !== revealVersion || !results.every(Boolean)) return;
        const focusedId = targets[targets.length - 1].elementId;
        publish({ ...snapshot, expanded, focusedId, scrollId: focusedId, scrollRevision: snapshot.scrollRevision + 1 });
      }
      guard(region.target, expandPaths)();
    }
    revealAttempt = runAttempt(region.target, load, apply);
  }

  /** Resolves an unknown preview hover to a visible row or nearest collapsed ancestor without expanding anything. */
  function discoverHover(target: Target, token: string): void {
    hoverAttempt?.cancel();
    if (!snapshot.region) return;
    const region = snapshot.region;
    /** Loads only ancestry metadata for the current stationary hover. */
    function load(signal: AbortSignal): Promise<readonly TreeNode[]> { return requestAncestors(target.elementId, region.target, signal); }
    /** Publishes the nearest row only if the same hover still owns the result. */
    function apply(path: readonly TreeNode[]): void {
      if (hoverToken !== token || !path.length) return;
      applyPath(path);
      publish({ ...snapshot, hoveredId: nearestVisibleRow(target.elementId, relations()) });
    }
    hoverAttempt = runAttempt(region.target, load, apply);
  }

  /** Mirrors active preview, selected rows and hover proxy from the sole host selection owner. */
  function synchronizeSelection(): void {
    const selected = selection.getSnapshot();
    const restoring = selected.activeScreenId !== snapshot.screenId && selected.activeScreenId !== null && remembered.has(selected.activeScreenId);
    if (selected.activeScreenId !== snapshot.screenId) activate(selected.activeScreenId);
    if (!snapshot.screenId) return;
    const selectedTargets = selected.screenId === snapshot.screenId ? selected.targets : [];
    const nextSelectionToken = `${snapshot.screenId}|${selectedTargets.map(item => item.elementId).join(",")}`;
    const nextHover = selected.hover?.screenId === snapshot.screenId ? selected.hover.target : null;
    const nextHoverToken = nextHover ? `${snapshot.screenId}|${nextHover.elementId}` : "";
    const selectedIds = new Set(selectedTargets.map(item => item.elementId));
    const hoveredId = nextHover ? nearestVisibleRow(nextHover.elementId, relations()) : null;
    publish({ ...snapshot, selected: selectedIds, hoveredId });
    if (nextSelectionToken !== selectionToken) {
      selectionToken = nextSelectionToken;
      revealAttempt?.cancel();
      if (selectedTargets.length) {
        const allVisible = selectedTargets.every(target => nearestVisibleRow(target.elementId, relations()) === target.elementId);
        if (allVisible) {
          const focusedId = selectedTargets[selectedTargets.length - 1].elementId;
          if (!restoring) publish({ ...snapshot, focusedId, scrollId: focusedId, scrollRevision: snapshot.scrollRevision + 1 });
        } else if (snapshot.query) {
          const projection = searchTree(snapshot.searchPaths);
          const searchExpanded = new Set(snapshot.searchExpanded);
          for (const target of selectedTargets) {
            let parent = projection.parents.get(target.elementId);
            while (parent) { searchExpanded.add(parent); parent = projection.parents.get(parent); }
          }
          const focusedId = selectedTargets[selectedTargets.length - 1].elementId;
          publish({ ...snapshot, searchExpanded, focusedId, scrollId: focusedId, scrollRevision: snapshot.scrollRevision + 1 });
        } else reveal(selectedTargets, selectionToken);
      }
    }
    if (nextHoverToken !== hoverToken) {
      hoverToken = nextHoverToken;
      hoverAttempt?.cancel();
      if (nextHover && hoveredId === null) discoverHover(nextHover, hoverToken);
    }
  }

  /** Applies a correlated direct-child response or rejects it into that row's existing attempt. */
  function receiveChildren(message: Extract<AgentMessage, { type: "tree-children-result" }>): void {
    const pending = pendingChildren.get(message.requestId);
    if (!pending) return;
    if (pending.parentId !== message.parentElementId) pending.reject(new Error("Tree children response mismatch"));
    else pending.resolve(message.children);
  }

  /** Applies a correlated path only when it ends at the identity that requested it. */
  function receiveAncestors(message: Extract<AgentMessage, { type: "tree-ancestors-result" }>): void {
    const pending = pendingAncestors.get(message.requestId);
    if (!pending) return;
    if (message.path.length && message.path[message.path.length - 1].elementId !== pending.elementId) pending.reject(new Error("Tree ancestors response mismatch"));
    else pending.resolve(message.path);
  }

  /** Subscribes exactly the loaded lazy levels, including collapsed ones, without loading unseen branches. */
  function watchTree(): void {
    if (!snapshot.screenId || !readyScreens.has(snapshot.screenId)) return;
    send(snapshot.screenId, { type: "tree-watch", parentElementIds: [null, ...snapshot.children.keys()] });
  }

  /** Replaces loaded levels for active or remembered trees and disposes only removed row owners. */
  function updateTree(screenId: string, levels: readonly TreeLevel[]): void {
    const current = screenId === snapshot.screenId ? snapshot : remembered.get(screenId);
    if (!current) return;
    const loaded = levels.filter(level => level.parentElementId === null || current.children.has(level.parentElementId));
    if (!loaded.length) return;
    const replacement = replaceTreeLevels(current, loaded);
    const rows = new Map(current.rows);
    for (const level of loaded) if (level.parentElementId !== null && !replacement.removed.has(level.parentElementId)) rows.set(level.parentElementId, { kind: "loaded", children: level.children.map(node => node.elementId) });
    for (const id of replacement.removed) rows.delete(id);
    const next = { ...current, ...replacement, rows, hoveredId: current.hoveredId && replacement.removed.has(current.hoveredId) ? null : current.hoveredId, focusedId: current.focusedId && replacement.removed.has(current.focusedId) ? null : current.focusedId };
    if (screenId !== snapshot.screenId) {
      remembered.set(screenId, next);
      if (replacement.removed.size) send(screenId, { type: "tree-watch", parentElementIds: [null, ...next.children.keys()] });
      return;
    }
    for (const id of replacement.removed) {
      const entry = rowOwners.get(id);
      entry?.unsubscribe();
      entry?.region.dispose();
      rowOwners.delete(id);
    }
    publish(next);
    if (replacement.removed.size) watchTree();
    const hover = selection.getSnapshot().hover;
    if (hover?.screenId === screenId && replacement.removed.has(hover.target.elementId)) selection.clearHover();
  }

  /** Starts one latest-query correlation with a Layers-owned deadline; matching updates stay live until replaced. */
  function requestSearch(): void {
    cancelSearchDeadline?.();
    if (!snapshot.region || !snapshot.screenId) return;
    searchRequest = ++requestId;
    publish({ ...snapshot, searchLoading: !!snapshot.query, searchPaths: [] });
    if (snapshot.query) {
      /** Fails only the live Layers search, never an Inspector or sibling preview. */
      function expired(): void { throw new Error("Couldn't load"); }
      cancelSearchDeadline = scopedTimeout(snapshot.region.target, expired, 3_000);
    }
    if (skipNextSearch) { skipNextSearch = false; return; }
    send(snapshot.screenId, { type: "tree-search", requestId: searchRequest, query: snapshot.query });
  }

  /** Captures the literal expansion snapshot on entry and restores it only when search clears. */
  function setQuery(query: string): void {
    if (query === snapshot.query || !snapshot.screenId) return;
    revealVersion += 1;
    revealAttempt?.cancel();
    const beforeSearch = snapshot.beforeSearch ?? new Set(snapshot.expanded);
    publish({ ...snapshot, query, beforeSearch: query ? beforeSearch : null, expanded: query ? snapshot.expanded : new Set(beforeSearch), scrollId: null });
    requestSearch();
  }

  /** Routes current replies and live updates; inactive trees update without retaining panel requests. */
  function receive(screenId: string, message: AgentMessage): void {
    if (message.type === "tree-update") {
      const region = screenId === snapshot.screenId ? snapshot.region : null;
      if (region) guard(region.target,
        /** Applies this mutation batch under its active panel's failure attribution. */
        () => updateTree(screenId, message.levels),
      )();
      else updateTree(screenId, message.levels);
      return;
    }
    if (screenId !== snapshot.screenId || !snapshot.region) return;
    /** Attributes tree/search application errors to Layers rather than the transport's preview region. */
    function apply(): void {
      if (message.type === "tree-children-result") receiveChildren(message);
      else if (message.type === "tree-ancestors-result") receiveAncestors(message);
      else if (message.type === "tree-search-result" && message.requestId === searchRequest && snapshot.query) {
        cancelSearchDeadline?.();
        cancelSearchDeadline = null;
        const projection = searchTree(message.paths);
        const previous = searchTree(snapshot.searchPaths);
        const searchExpanded = new Set([...snapshot.searchExpanded].filter(id => projection.nodes.has(id)));
        for (const id of projection.expanded) if (snapshot.searchLoading || !previous.nodes.has(id)) searchExpanded.add(id);
        publish({ ...snapshot, searchLoading: false, searchPaths: message.paths, searchExpanded });
      }
    }
    guard(snapshot.region.target, apply)();
  }

  /** Marks a connected page ready and starts a deferred active root load. */
  function ready(screenId: string): void {
    readyScreens.add(screenId);
    if (snapshot.screenId === screenId && !snapshot.roots.length && !rootAttempt) loadRoot();
  }

  /** Drops one replaced document's ids and requests while preserving the active-preview choice for its next ready instance. */
  function forget(screenId: string): void {
    readyScreens.delete(screenId);
    remembered.delete(screenId);
    positions.delete(screenId);
    if (snapshot.screenId !== screenId) return;
    clearWork();
    snapshot.region?.dispose();
    const region = panelRegion(screenId);
    selectionToken = hoverToken = "";
    publish({ ...emptySnapshot(snapshot.revision + 1), screenId, region });
  }

  /** Expands a child-bearing row on first use or collapses it without cancelling its reusable in-flight request. */
  function toggle(elementId: string): void {
    if (snapshot.query) {
      const searchExpanded = new Set(snapshot.searchExpanded);
      if (searchExpanded.has(elementId)) searchExpanded.delete(elementId);
      else searchExpanded.add(elementId);
      publish({ ...snapshot, searchExpanded, focusedId: elementId });
      return;
    }
    const node = snapshot.nodes.get(elementId);
    if (!node?.hasChildren) return;
    const expanded = new Set(snapshot.expanded);
    if (expanded.has(elementId)) expanded.delete(elementId);
    else {
      expanded.add(elementId);
      loadRow(elementId);
    }
    publish({ ...snapshot, expanded, focusedId: elementId });
  }

  /** Restarts only one failed row after RegionBoundary has created its fresh retry generation. */
  function retryRow(elementId: string): void { loadRow(elementId); }

  /** Selects a row through the shared selection owner and scrolls only that iframe document to it. */
  function selectRow(elementId: string, shift: boolean): void {
    if (!snapshot.screenId) return;
    const node = snapshot.query ? searchTree(snapshot.searchPaths).nodes.get(elementId) : snapshot.nodes.get(elementId);
    if (!node) return;
    publish({ ...snapshot, focusedId: elementId });
    selection.select(snapshot.screenId, node, shift);
    send(snapshot.screenId, { type: "scroll-element", elementId });
  }

  /** Makes row hover the one global hover source, so preview movement can replace it naturally. */
  function hoverRow(elementId: string | null): void {
    if (!snapshot.screenId) return;
    const node = elementId ? (snapshot.query ? searchTree(snapshot.searchPaths).nodes : snapshot.nodes).get(elementId) : null;
    selection.hover(snapshot.screenId, node ?? null, "layers");
  }

  /** Replaces selection on vertical arrows; horizontal arrows move focus or expand/collapse without selecting. */
  function key(key: string): void {
    const projection = relations();
    const visible = visibleTreeRows(projection);
    if (!visible.length) return;
    const index = Math.max(0, visible.findIndex(row => row.elementId === snapshot.focusedId));
    const currentId = visible[index].elementId;
    if (key === "ArrowDown") selectRow(visible[Math.min(index + 1, visible.length - 1)].elementId, false);
    else if (key === "ArrowUp") selectRow(visible[Math.max(index - 1, 0)].elementId, false);
    else if (key === "ArrowRight") {
      const node = (snapshot.query ? searchTree(snapshot.searchPaths).nodes : snapshot.nodes).get(currentId);
      if (!node?.hasChildren) return;
      if (!projection.expanded.has(currentId)) toggle(currentId);
      else {
        const first = projection.children.get(currentId)?.[0];
        if (first) publish({ ...snapshot, focusedId: first });
      }
    } else if (key === "ArrowLeft") {
      if (projection.expanded.has(currentId)) toggle(currentId);
      else {
        const parentId = projection.parents.get(currentId);
        if (parentId) publish({ ...snapshot, focusedId: parentId });
      }
    }
  }

  /** Aligns store-owned keyboard position when a row receives focus by click or direct tab movement. */
  function focusRow(elementId: string): void {
    if (snapshot.focusedId !== elementId && (snapshot.query ? searchTree(snapshot.searchPaths).nodes : snapshot.nodes).has(elementId)) publish({ ...snapshot, focusedId: elementId });
  }

  /** Initializes focus when keyboard users enter a nonempty panel without a current row. */
  function focusFirst(): void {
    if (snapshot.focusedId) return;
    const first = visibleTreeRows(relations())[0];
    if (first) publish({ ...snapshot, focusedId: first.elementId });
  }

  /** Remembers numeric panel scrolling without rendering on every native scroll event. */
  function setScroll(top: number, left: number): void {
    if (snapshot.screenId) positions.set(snapshot.screenId, { top, left });
  }

  /** Exposes the current preview's saved vertical and horizontal deep-tree scrolling. */
  function getScroll(): { top: number; left: number } {
    return snapshot.screenId ? positions.get(snapshot.screenId) ?? { top: 0, left: 0 } : { top: 0, left: 0 };
  }

  /** Drops all per-document tree memory when the board generation reloads. */
  function reset(): void {
    activate(null);
    remembered.clear();
    positions.clear();
    readyScreens.clear();
  }

  /** Recreates cancelled child attempts after a Layers Retry while preserving literal search and per-preview tree memory. */
  function retryLayers(): void {
    const screenId = snapshot.screenId;
    const region = snapshot.region;
    if (!screenId || !region) return;
    const prior = snapshot;
    const retryError = renderRetryError;
    const rows = new Map([...prior.rows].filter(([, state]) => state.kind === "loaded"));
    clearWork();
    selectionToken = hoverToken = "";
    publish({ ...prior, revision: prior.revision + 1, region, rows, renderError: retryError, scrollId: null });
    if (readyScreens.has(screenId)) {
      loadRoot();
      watchTree();
      for (const id of snapshot.expanded) if (snapshot.nodes.get(id)?.hasChildren && !snapshot.rows.has(id)) loadRow(id);
      if (snapshot.query) requestSearch();
    }
    synchronizeSelection();
  }

  /** Restarts one expandable row through its real failure or three-second no-answer path, unsubscribing its old level first. */
  function injectRowRequest(timeout: boolean): void {
    const candidates = visibleTreeRows(relations()).map(row => snapshot.nodes.get(row.elementId)).filter(value => value?.hasChildren);
    const node = candidates.find(value => snapshot.rows.get(value!.elementId)?.kind !== "loaded") ?? candidates[0];
    if (!node) return;
    const prior = rowOwners.get(node.elementId);
    if (prior) {
      prior.unsubscribe();
      prior.region.dispose();
      rowOwners.delete(node.elementId);
    }
    const rows = new Map(snapshot.rows);
    rows.delete(node.elementId);
    const children = new Map(snapshot.children);
    children.delete(node.elementId);
    const expanded = new Set(snapshot.expanded);
    expanded.add(node.elementId);
    if (timeout) skipNextParent = node.elementId;
    else failNextParent = node.elementId;
    publish({ ...snapshot, rows, children, expanded });
    watchTree();
    loadRow(node.elementId);
  }

  /** Makes one row fail while every sibling remains usable. */
  function injectRowFailure(): void { injectRowRequest(false); }

  /** Leaves one actual registered child request unanswered until its normal row deadline. */
  function injectRowTimeout(): void { injectRowRequest(true); }

  /** Leaves a real search unanswered so its normal three-second Layers deadline is exercised. */
  function injectSearchTimeout(): void {
    if (!snapshot.screenId) return;
    skipNextSearch = true;
    if (snapshot.query) requestSearch();
    else setQuery("Setting 30.10");
  }

  /** Arms the failed row's real Retry without creating a failure before that click. */
  function armRowRetry(): void {
    const row = [...snapshot.rows].find(([, state]) => state.kind === "error");
    if (row) failNextParent = row[0];
  }

  /** Arms an explicit whole-Layers Retry to rethrow its prior render identity in a fresh generation. */
  function armPanelRetry(): void { if (snapshot.region) renderRetryError = snapshot.renderError ?? new Error("Layers retry render failure"); }

  /** Throws from the actual Layers render path while retaining board and Inspector state. */
  function injectRenderFailure(): void { publish({ ...snapshot, renderError: new Error("Layers render failure") }); }

  /** Supplies the current whole-panel owner to dev trigger guards. */
  function layersTarget(): FailureTarget { return snapshot.region?.target ?? owner(); }

  if (dev) {
    removeTriggers.push(
      registerDevTrigger({ id: "layers-row-fail", label: "Layers row load fails", target: layersTarget, run: injectRowFailure }),
      registerDevTrigger({ id: "layers-row-timeout", label: "Layers row never answers (3s)", target: layersTarget, run: injectRowTimeout }),
      registerDevTrigger({ id: "layers-search-timeout", label: "Layers search never answers (3s)", target: layersTarget, run: injectSearchTimeout }),
      registerDevTrigger({ id: "layers-row-retry-fail", label: "Next failed Layers row Retry fails once", target: layersTarget, run: armRowRetry }),
      registerDevTrigger({ id: "layers-retry-fail", label: "Next Layers Retry rethrows render error", target: layersTarget, run: armPanelRetry }),
      registerDevTrigger({ id: "layers-render", label: "Layers render fails", target: layersTarget, run: injectRenderFailure }),
    );
  }

  const unsubscribeSelection = selection.subscribe(synchronizeSelection);
  synchronizeSelection();

  /** Reads one immutable panel projection for React and failure boundaries. */
  function getSnapshot(): LayersSnapshot { return snapshot; }

  /** Registers a Layers view without exposing tree mutation. */
  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    /** Removes only this panel reader. */
    return function unsubscribe(): void { listeners.delete(listener); };
  }

  /** Cancels every panel/reply lifetime and dev registration with the board generation. */
  function dispose(): void {
    unsubscribeSelection();
    clearWork();
    snapshot.region?.dispose();
    for (const remove of removeTriggers) remove();
    listeners.clear();
  }

  return { getSnapshot, subscribe, receive, ready, forget, toggle, retryRow, retryLayers, selectRow, hoverRow, key, focusRow, focusFirst, setQuery, setScroll, getScroll, reset, dispose };
}

export type LayersStore = ReturnType<typeof createLayers>;
