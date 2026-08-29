export interface KeywordNode {
  id: string;
  term: string;
  notes: string;
  children: KeywordNode[];
  source: 'user' | 'ai';
  createdAt: string;
}

export interface Box {
  id: string;
  root: KeywordNode;
  createdAt: string;
}

export function createNode(term: string, source: KeywordNode['source']): KeywordNode {
  return {
    id: crypto.randomUUID(),
    term,
    notes: '',
    children: [],
    source,
    createdAt: new Date().toISOString(),
  };
}
