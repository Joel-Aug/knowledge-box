interface KeeperProps {
  active?: boolean;
  message?: string;
  size?: 'sm' | 'lg';
}

export default function Keeper({ active = false, message, size = 'sm' }: KeeperProps) {
  const dim = size === 'lg' ? 'w-14 h-14' : 'w-8 h-8';

  return (
    <div className="flex items-center gap-3">
      <div className={`relative ${dim} shrink-0`}>
        <div
          className={`absolute inset-0 rounded-full border border-primary/40 ${active ? 'keeper-ring' : ''}`}
          style={{ borderStyle: 'dashed' }}
        />
        <div
          className={`absolute inset-[3px] rounded-full keeper-core ${active ? 'keeper-active' : ''}`}
          style={{
            background: 'radial-gradient(circle at 35% 30%, #c4b5fd, #8b5cf6 45%, #22d3ee 100%)',
          }}
        />
      </div>
      {message && (
        <p className="text-xs font-mono text-accent/80 tracking-wide">{message}</p>
      )}
    </div>
  );
}
