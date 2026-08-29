import { useState } from 'react';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { Box, createNode } from '../types';
import { mapNode, removeNode, countTerms, findNode, findPath } from '../services/tree';
import { suggestRelated } from '../services/ai';
import TreeNode from './TreeNode';
import Keeper from './Keeper';

interface BoxViewProps {
  box: Box;
  onChange: (box: Box) => void;
  onBack: () => void;
}

export default function BoxView({ box, onChange, onBack }: BoxViewProps) {
  const [suggestingId, setSuggestingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const update = (id: string, fn: (n: typeof box.root) => typeof box.root) => {
    onChange({ ...box, root: mapNode(box.root, id, fn) });
  };

  const handleAddChild = (parentId: string, term: string) => {
    update(parentId, (n) => ({ ...n, children: [...n.children, createNode(term, 'user')] }));
  };

  const handleRename = (nodeId: string, term: string) => {
    update(nodeId, (n) => ({ ...n, term }));
  };

  const handleDelete = (nodeId: string) => {
    onChange({ ...box, root: removeNode(box.root, nodeId) });
  };

  const handleSetNotes = (nodeId: string, notes: string) => {
    update(nodeId, (n) => ({ ...n, notes }));
  };

  const handleSuggest = async (nodeId: string) => {
    const node = findNode(box.root, nodeId);
    if (!node) return;
    setError(null);
    setSuggestingId(nodeId);
    try {
      const ancestorTerms = findPath(box.root, nodeId) ?? [];
      const alreadyPresent = node.children.map((c) => c.term);
      const groups = await suggestRelated(node.term, ancestorTerms, alreadyPresent);
      update(nodeId, (n) => ({
        ...n,
        children: [
          ...n.children,
          ...groups.map((g) => {
            const header = createNode(g.header, 'ai');
            header.children = g.items.map((item) => createNode(item, 'ai'));
            return header;
          }),
        ],
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The Keeper faltered reaching beyond the vault.');
    } finally {
      setSuggestingId(null);
    }
  };

  const isThinking = suggestingId !== null;

  return (
    <div className="min-h-screen max-w-3xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-accent transition-colors">
          <ArrowLeft size={16} /> all vaults
        </button>
        <Keeper active={isThinking} message={isThinking ? 'the Keeper is threading new connections...' : undefined} />
        <span className="text-xs font-mono text-slate-600">{countTerms(box.root)} keywords</span>
      </div>

      {error && (
        <div className="mb-4 text-sm bg-red-950/40 text-red-300 border border-red-800/60 rounded-xl px-4 py-2.5 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400/70 hover:text-red-300">&times;</button>
        </div>
      )}

      {box.root.children.length === 0 && suggestingId === null && (
        <button
          onClick={() => handleSuggest(box.root.id)}
          className="mb-5 flex items-center gap-1.5 text-sm text-white bg-primary/90 hover:bg-primary rounded-xl px-4 py-2.5 shadow-[0_0_24px_-6px_rgba(139,92,246,0.8)] transition-all"
        >
          <Sparkles size={15} /> ask the Keeper to unfold this vault
        </button>
      )}

      <div className="bg-panel border border-edge rounded-2xl p-5">
        <TreeNode
          node={box.root}
          ancestors={[]}
          depth={0}
          suggestingId={suggestingId}
          onAddChild={handleAddChild}
          onRename={handleRename}
          onDelete={handleDelete}
          onSetNotes={handleSetNotes}
          onSuggest={handleSuggest}
        />
      </div>
    </div>
  );
}
