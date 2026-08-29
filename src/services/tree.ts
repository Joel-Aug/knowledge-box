import { KeywordNode } from '../types';

export function mapNode(
  node: KeywordNode,
  id: string,
  fn: (n: KeywordNode) => KeywordNode
): KeywordNode {
  if (node.id === id) return fn(node);
  return { ...node, children: node.children.map((c) => mapNode(c, id, fn)) };
}

export function removeNode(node: KeywordNode, id: string): KeywordNode {
  return {
    ...node,
    children: node.children.filter((c) => c.id !== id).map((c) => removeNode(c, id)),
  };
}

export function findNode(node: KeywordNode, id: string): KeywordNode | null {
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

export function findPath(node: KeywordNode, id: string, trail: string[] = []): string[] | null {
  if (node.id === id) return trail;
  for (const child of node.children) {
    const found = findPath(child, id, [...trail, node.term]);
    if (found) return found;
  }
  return null;
}

export function countTerms(node: KeywordNode): number {
  return 1 + node.children.reduce((sum, c) => sum + countTerms(c), 0);
}
