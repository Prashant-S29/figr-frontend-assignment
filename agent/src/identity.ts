// Owns reference-stable element ids, names and DOM traversal; rebuilt-node reconciliation is deferred to M5 and selection stays in the host.
import type { Direction, Target } from "../../shared/protocol";
import { native } from "./native";

/** Creates one document's element bindings without retaining detached page nodes through hovered-id history. */
export function createIdentity(instanceId: string) {
  const ids = new WeakMap<Element, string>();
  const nodes = new Map<string, WeakRef<Element>>();
  let serial = 0;

  /** Describes a real inspectable element as an agent identity and text-only PRD name. */
  function describe(element: Element | null): Target | null {
    if (!element || element === document.documentElement || element === document.body) return null;
    let elementId = ids.get(element);
    if (!elementId) {
      elementId = `${instanceId}:${++serial}`;
      ids.set(element, elementId);
      nodes.set(elementId, new native.WeakRef(element));
    }
    const tag = element.tagName.toLowerCase();
    const label = native.getAttribute.call(element, "data-name");
    const firstClass = native.getAttribute.call(element, "class")?.trim().split(/\s+/)[0];
    const id = native.getAttribute.call(element, "id");
    return { elementId, name: label ?? (firstClass ? `${tag}.${firstClass}` : id ? `${tag}#${id}` : tag) };
  }
  /** Resolves only a still-connected original node; no index or lookalike is substituted. */
  function lookup(elementId: string): Element | null {
    const ref = nodes.get(elementId);
    const element = ref ? native.weakDeref.call(ref) : undefined;
    return element?.isConnected ? element : null;
  }
  /** Resolves child/parent/sibling relations against the current DOM, wrapping siblings without matching by index. */
  function navigate(elementId: string, direction: Direction): Target | null {
    const element = lookup(elementId);
    if (!element) return null;
    const next = direction === "child" ? element.firstElementChild : direction === "parent" ? element.parentElement
      : direction === "next" ? element.nextElementSibling ?? element.parentElement?.firstElementChild
      : element.previousElementSibling ?? element.parentElement?.lastElementChild;
    return describe(next ?? null);
  }
  return { describe, lookup, navigate };
}
export type Identity = ReturnType<typeof createIdentity>;
