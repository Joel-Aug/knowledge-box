import { Trash2, ChevronRight } from 'lucide-react';
import { Box } from '../types';
import { countTerms } from '../services/tree';
import NewBoxInput from './NewBoxInput';
import Keeper from './Keeper';

interface BoxListProps {
  boxes: Box[];
  onCreate: (keyword: string) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function BoxList({ boxes, onCreate, onOpen, onDelete }: BoxListProps) {
  return (
    <div className="min-h-screen max-w-2xl mx-auto px-6 py-14">
      <div className="flex items-center gap-4 mb-2">
        <Keeper size="lg" />
        <div>
          <h1 className="text-2xl font-display font-bold tracking-wider text-white glow-text">KNOWLEDGE BOX</h1>
          <p className="text-xs font-mono text-accent/60 mt-0.5">tended by the Keeper</p>
        </div>
      </div>
      <p className="text-sm text-slate-400 mb-8 max-w-lg">
        A multidimensional archive. Offer one keyword and the Keeper unfolds it into a living vault of related ideas.
      </p>

      <NewBoxInput onCreate={onCreate} />

      <div className="mt-10 space-y-3">
        {boxes.length === 0 && (
          <p className="text-sm text-slate-500 text-center py-14 font-mono">
            the Keeper waits, dormant, for a first keyword.
          </p>
        )}
        {boxes.map((box) => (
          <div
            key={box.id}
            onClick={() => onOpen(box.id)}
            className="group flex items-center justify-between bg-panel border border-edge rounded-xl px-5 py-4 hover:border-primary/50 hover:glow-border cursor-pointer transition-all duration-300"
          >
            <div>
              <p className="font-medium text-slate-100 tracking-wide">{box.root.term}</p>
              <p className="text-xs font-mono text-accent/50">{countTerms(box.root)} keywords bound</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Collapse the "${box.root.term}" vault and everything within it?`)) onDelete(box.id);
                }}
                className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-opacity"
              >
                <Trash2 size={15} />
              </button>
              <ChevronRight size={16} className="text-primary/50 group-hover:text-primary transition-colors" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
