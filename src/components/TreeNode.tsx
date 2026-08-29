import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Sparkles, Pencil, Trash2, Check, X, StickyNote } from 'lucide-react';
import { KeywordNode } from '../types';

interface TreeNodeProps {
  node: KeywordNode;
  ancestors: string[];
  depth: number;
  suggestingId: string | null;
  onAddChild: (parentId: string, term: string) => void;
  onRename: (nodeId: string, term: string) => void;
  onDelete: (nodeId: string) => void;
  onSetNotes: (nodeId: string, notes: string) => void;
  onSuggest: (nodeId: string) => void;
}

export default function TreeNode({
  node,
  ancestors,
  depth,
  suggestingId,
  onAddChild,
  onRename,
  onDelete,
  onSetNotes,
  onSuggest,
}: TreeNodeProps) {
  const [expanded, setExpanded] = useState(depth < 2);
  const [adding, setAdding] = useState(false);
  const [childInput, setChildInput] = useState('');
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(node.term);
  const [notesOpen, setNotesOpen] = useState(false);

  const isSuggesting = suggestingId === node.id;
  const hasChildren = node.children.length > 0;

  const submitChild = () => {
    const term = childInput.trim();
    if (term) {
      onAddChild(node.id, term);
      setChildInput('');
    }
    setAdding(false);
  };

  const submitRename = () => {
    const term = editValue.trim();
    if (term) onRename(node.id, term);
    setEditing(false);
  };

  return (
    <div className={depth > 0 ? 'ml-5 pl-4' : ''}>
      <div className={depth > 0 ? 'relative' : ''}>
        {depth > 0 && (
          <div className="absolute left-0 top-0 bottom-0 w-px thread -ml-4" />
        )}
        <div className="group flex items-start gap-1.5 py-1.5">
          <button
            onClick={() => setExpanded((e) => !e)}
            className={`mt-0.5 shrink-0 text-slate-600 hover:text-accent transition-colors ${!hasChildren ? 'invisible' : ''}`}
          >
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {editing ? (
                <input
                  autoFocus
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitRename();
                    if (e.key === 'Escape') setEditing(false);
                  }}
                  onBlur={submitRename}
                  className="bg-panel2 border border-primary/50 rounded px-1.5 py-0.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-primary"
                />
              ) : (
                <span
                  className={`text-sm ${depth === 0 ? 'font-display font-semibold text-base tracking-wide text-white glow-text' : node.children.length && depth === 1 ? 'font-medium text-slate-100' : 'text-slate-300'}`}
                >
                  {node.term}
                </span>
              )}
              {node.source === 'ai' && (
                <Sparkles size={11} className="text-accent" strokeWidth={2.5} />
              )}

              <span className="hidden group-hover:flex items-center gap-1 text-slate-600">
                <button title="Ask the Keeper" onClick={() => onSuggest(node.id)} disabled={isSuggesting} className="hover:text-accent disabled:opacity-50">
                  <Sparkles size={14} className={isSuggesting ? 'animate-pulse' : ''} />
                </button>
                <button title="Add sub-keyword" onClick={() => setAdding(true)} className="hover:text-primary">
                  <Plus size={14} />
                </button>
                <button title="Rename" onClick={() => { setEditValue(node.term); setEditing(true); }} className="hover:text-slate-300">
                  <Pencil size={13} />
                </button>
                <button title="Notes" onClick={() => setNotesOpen((o) => !o)} className="hover:text-amber-400">
                  <StickyNote size={13} />
                </button>
                {depth > 0 && (
                  <button
                    title="Delete"
                    onClick={() => { if (confirm(`Delete "${node.term}" and everything under it?`)) onDelete(node.id); }}
                    className="hover:text-red-400"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </span>
            </div>

            {isSuggesting && (
              <p className="text-xs font-mono text-accent/70 mt-0.5">weaving...</p>
            )}

            {notesOpen && (
              <textarea
                value={node.notes}
                onChange={(e) => onSetNotes(node.id, e.target.value)}
                placeholder="notes..."
                className="mt-1 w-full max-w-md text-xs bg-panel2 border border-edge rounded p-1.5 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-primary"
                rows={2}
              />
            )}

            {adding && (
              <div className="flex items-center gap-1 mt-1">
                <input
                  autoFocus
                  value={childInput}
                  onChange={(e) => setChildInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitChild();
                    if (e.key === 'Escape') setAdding(false);
                  }}
                  placeholder="new sub-keyword"
                  className="bg-panel2 border border-edge rounded px-1.5 py-0.5 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <button onClick={submitChild} className="text-emerald-400 hover:text-emerald-300"><Check size={14} /></button>
                <button onClick={() => setAdding(false)} className="text-slate-500 hover:text-slate-300"><X size={14} /></button>
              </div>
            )}
          </div>
        </div>

        {expanded && hasChildren && (
          <div>
            {node.children.map((child) => (
              <TreeNode
                key={child.id}
                node={child}
                ancestors={[...ancestors, node.term]}
                depth={depth + 1}
                suggestingId={suggestingId}
                onAddChild={onAddChild}
                onRename={onRename}
                onDelete={onDelete}
                onSetNotes={onSetNotes}
                onSuggest={onSuggest}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
