// Owns element ids, mutation-driven unique reconciliation, names and DOM traversal; selection and disappearance UI stay in the host.
import type { Direction, Target, TreeNode } from "../../shared/protocol";
import { native } from "./native";
import { matchChildren, type MatchIdentity } from "./reconcile";

interface Binding extends MatchIdentity {
  readonly elementId: string;
  parentId: string | null;
  node: WeakRef<Element>;
  exposed: boolean;
}

export interface ReconcileResult {
  readonly targets: readonly Target[];
  readonly goneElementIds: readonly string[];
}

/** Creates one document's ids and retains only weak node references plus the evidence needed to reconcile rebuilt paths. */
export function createIdentity(instanceId: string) {
  const ids = new WeakMap<Element, string>();
  const records = new Map<string, Binding>();
  const children = new Map<string | null, Set<string>>();
  let serial = 0;
  let observer: MutationObserver | null = null;

  /** Produces the page-facing name without allowing page strings to become markup. */
  function name(element: Element): string {
    const tag = element.tagName.toLowerCase();
    const label = native.getAttribute.call(element, "data-name");
    const firstClass = native.getAttribute.call(element, "class")?.trim().split(/\s+/)[0];
    const domId = native.getAttribute.call(element, "id");
    return label ?? (firstClass ? `${tag}.${firstClass}` : domId ? `${tag}#${domId}` : tag);
  }

  /** Captures deterministic tag, sorted-attribute and normalized-text evidence before a node can be replaced. */
  function evidence(element: Element, token: string): MatchIdentity {
    const attributes = Array.from(element.attributes, attribute => [attribute.name, attribute.value] as const)
      .sort(([left], [right]) => left.localeCompare(right));
    const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
    const strict = JSON.stringify([element.tagName.toLowerCase(), attributes, text]);
    return {
      token,
      dataKey: native.getAttribute.call(element, "data-key"),
      domId: native.getAttribute.call(element, "id"),
      strict,
      relaxed: strict.replace(/\d+/g, ""),
    };
  }

  /** Moves a surviving reference between known parents without treating a real node move as a replacement. */
  function move(binding: Binding, parentId: string | null): void {
    if (binding.parentId === parentId) return;
    children.get(binding.parentId)?.delete(binding.elementId);
    binding.parentId = parentId;
    const siblings = children.get(parentId) ?? new Set<string>();
    siblings.add(binding.elementId);
    children.set(parentId, siblings);
  }

  /** Refreshes identity evidence only after a node is known to be the same element. */
  function refresh(binding: Binding, element: Element): void {
    const next = evidence(element, binding.elementId);
    binding.dataKey = next.dataKey;
    binding.domId = next.domId;
    binding.strict = next.strict;
    binding.relaxed = next.relaxed;
  }

  /** Ensures the ancestor path exists so detached descendants can later be reconciled top-down per parent. */
  function bind(element: Element, exposed: boolean): Binding | null {
    if (element === document.documentElement || element === document.body) return null;
    const knownId = ids.get(element);
    const known = knownId ? records.get(knownId) : undefined;
    if (known) {
      if (exposed) known.exposed = true;
      return known;
    }
    const parent = element.parentElement;
    const parentBinding = parent ? bind(parent, false) : null;
    const elementId = `${instanceId}:${++serial}`;
    const captured = evidence(element, elementId);
    const binding: Binding = {
      ...captured,
      elementId,
      parentId: parentBinding?.elementId ?? null,
      node: new native.WeakRef(element),
      exposed,
    };
    ids.set(element, elementId);
    records.set(elementId, binding);
    const siblings = children.get(binding.parentId) ?? new Set<string>();
    siblings.add(elementId);
    children.set(binding.parentId, siblings);
    return binding;
  }

  /** Describes a real inspectable element and marks only identities that have crossed the agent boundary as exposed. */
  function describe(element: Element | null): Target | null {
    if (!element || element === document.documentElement || element === document.body) return null;
    const binding = bind(element, true)!;
    return { elementId: binding.elementId, name: name(element) };
  }

  /** Describes one tree row with the key used for row-failure attribution and a cheap child-presence hint. */
  function describeTree(element: Element): TreeNode {
    const target = describe(element)!;
    return {
      ...target,
      dataKey: native.getAttribute.call(element, "data-key"),
      hasChildren: element.firstElementChild !== null,
    };
  }

  /** Resolves the current uniquely proven binding, including a node adopted during reconciliation. */
  function lookup(elementId: string): Element | null {
    const binding = records.get(elementId);
    const element = binding ? native.weakDeref.call(binding.node) : undefined;
    return element?.isConnected ? element : null;
  }

  /** Resolves child/parent/sibling relations against current nodes, wrapping siblings without identity-by-index. */
  function navigate(elementId: string, direction: Direction): Target | null {
    const element = lookup(elementId);
    if (!element) return null;
    const next = direction === "child" ? element.firstElementChild : direction === "parent" ? element.parentElement
      : direction === "next" ? element.nextElementSibling ?? element.parentElement?.firstElementChild
      : element.previousElementSibling ?? element.parentElement?.lastElementChild;
    return describe(next ?? null);
  }

  /** Returns one lazy child level, using body children as the panel's invisible root. */
  function treeChildren(parentElementId: string | null): TreeNode[] {
    const parent = parentElementId === null ? document.body : lookup(parentElementId);
    return parent ? Array.from(parent.children, describeTree) : [];
  }

  /** Returns the body-relative ancestor path needed to reveal a selected row without exposing DOM nodes. */
  function treeAncestors(elementId: string): TreeNode[] {
    const element = lookup(elementId);
    if (!element) return [];
    const path: Element[] = [];
    let current: Element | null = element;
    while (current && current !== document.body && current !== document.documentElement) {
      path.push(current);
      current = current.parentElement;
    }
    return path.reverse().map(describeTree);
  }

  /** Scrolls only the inspected document's nested containers and viewport to the current identity. */
  function scrollElement(elementId: string): void {
    const element = lookup(elementId);
    if (element) native.scrollIntoView.call(element, { block: "nearest", inline: "nearest" });
  }

  /** Rebinds one detached sibling set only where the ordered evidence is unique among all unclaimed candidates. */
  function reconcileChildren(parentId: string | null, parent: Element): Target[] {
    const rebound: Target[] = [];
    const siblingIds = children.get(parentId);
    if (!siblingIds?.size) return rebound;
    const detached: Binding[] = [];
    for (const elementId of siblingIds) {
      const binding = records.get(elementId);
      const element = binding ? native.weakDeref.call(binding.node) : undefined;
      if (binding && !element?.isConnected) detached.push(binding);
    }
    const candidates: MatchIdentity[] = [];
    const candidateNodes = new Map<string, Element>();
    let candidateSerial = 0;
    for (const element of Array.from(parent.children)) {
      const knownId = ids.get(element);
      if (knownId && records.get(knownId)?.node && lookup(knownId) === element) continue;
      // Candidate tokens only correlate this pass's result; sibling position is never matching evidence.
      const token = `candidate:${++candidateSerial}`;
      candidates.push(evidence(element, token));
      candidateNodes.set(token, element);
    }
    const matches = matchChildren(detached.map(binding => ({
      token: binding.elementId,
      dataKey: binding.dataKey,
      domId: binding.domId,
      strict: binding.strict,
      relaxed: binding.relaxed,
    })), candidates);
    for (const binding of detached) {
      const token = matches.get(binding.elementId);
      const element = token ? candidateNodes.get(token) : undefined;
      if (!element) continue;
      const old = native.weakDeref.call(binding.node);
      if (old) ids.delete(old);
      ids.set(element, binding.elementId);
      binding.node = new native.WeakRef(element);
      refresh(binding, element);
      if (binding.exposed) rebound.push({ elementId: binding.elementId, name: name(element) });
    }
    for (const elementId of Array.from(siblingIds)) {
      const binding = records.get(elementId);
      const element = binding ? native.weakDeref.call(binding.node) : undefined;
      if (binding && element?.isConnected && element.parentElement === parent) {
        rebound.push(...reconcileChildren(binding.elementId, element));
      }
    }
    return rebound;
  }

  /** Deletes only identities left disconnected after the complete top-down pass and reports exposed ones as gone. */
  function removeGone(): string[] {
    const gone: string[] = [];
    for (const [elementId, binding] of Array.from(records)) {
      const element = native.weakDeref.call(binding.node);
      if (element?.isConnected) continue;
      if (binding.exposed) gone.push(elementId);
      if (element) ids.delete(element);
      records.delete(elementId);
      children.get(binding.parentId)?.delete(elementId);
      children.delete(elementId);
    }
    return gone;
  }

  /** Applies reference survival first, then reconciles detached paths from body children downward. */
  function reconcile(): ReconcileResult {
    for (const binding of Array.from(records.values())) {
      const element = native.weakDeref.call(binding.node);
      if (!element?.isConnected) continue;
      const parent = element.parentElement;
      const parentBinding = parent ? bind(parent, false) : null;
      move(binding, parentBinding?.elementId ?? null);
      refresh(binding, element);
    }
    const targets = document.body ? reconcileChildren(null, document.body) : [];
    return { targets, goneElementIds: removeGone() };
  }

  /** Observes page mutations once and contains callback failures so inspected page scripts remain unaffected. */
  function observe(onResult: (result: ReconcileResult) => void, afterMutation: () => void, failure: (error: unknown) => void): void {
    if (observer) return;
    /** Reconciles one delivered mutation batch before stationary-pointer hit-testing runs. */
    function mutated(): void {
      try {
        const result = reconcile();
        if (result.targets.length || result.goneElementIds.length) onResult(result);
        afterMutation();
      } catch (error) {
        failure(error);
      }
    }
    observer = new native.MutationObserver(mutated);
    native.observeMutations.call(observer, document, { childList: true, subtree: true, attributes: true, characterData: true });
  }

  return { describe, lookup, navigate, treeChildren, treeAncestors, scrollElement, observe };
}
export type Identity = ReturnType<typeof createIdentity>;
