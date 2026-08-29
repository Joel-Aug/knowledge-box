import { useState } from 'react';
import { Plus } from 'lucide-react';

interface NewBoxInputProps {
  onCreate: (keyword: string) => void;
}

export default function NewBoxInput({ onCreate }: NewBoxInputProps) {
  const [value, setValue] = useState('');

  const submit = () => {
    const keyword = value.trim();
    if (!keyword) return;
    onCreate(keyword);
    setValue('');
  };

  return (
    <div className="flex items-center gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="offer a keyword..."
        className="flex-1 bg-panel border border-edge rounded-xl px-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-primary/60 focus:glow-border transition-all"
      />
      <button
        onClick={submit}
        className="flex items-center gap-1.5 bg-primary/90 hover:bg-primary text-white rounded-xl px-4 py-2.5 text-sm shrink-0 shadow-[0_0_20px_-6px_rgba(139,92,246,0.8)] transition-all"
      >
        <Plus size={16} /> Unfold
      </button>
    </div>
  );
}
