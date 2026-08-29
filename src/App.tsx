import { useEffect, useState } from 'react';
import { Box, createNode } from './types';
import { loadBoxes, saveBoxes } from './services/storage';
import BoxList from './components/BoxList';
import BoxView from './components/BoxView';

export default function App() {
  const [boxes, setBoxes] = useState<Box[]>(() => loadBoxes());
  const [openBoxId, setOpenBoxId] = useState<string | null>(null);

  useEffect(() => {
    saveBoxes(boxes);
  }, [boxes]);

  const handleCreate = (keyword: string) => {
    const box: Box = {
      id: crypto.randomUUID(),
      root: createNode(keyword, 'user'),
      createdAt: new Date().toISOString(),
    };
    setBoxes((prev) => [box, ...prev]);
    setOpenBoxId(box.id);
  };

  const handleDelete = (id: string) => {
    setBoxes((prev) => prev.filter((b) => b.id !== id));
  };

  const handleBoxChange = (updated: Box) => {
    setBoxes((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
  };

  const openBox = boxes.find((b) => b.id === openBoxId) ?? null;

  if (openBox) {
    return <BoxView box={openBox} onChange={handleBoxChange} onBack={() => setOpenBoxId(null)} />;
  }

  return (
    <BoxList boxes={boxes} onCreate={handleCreate} onOpen={setOpenBoxId} onDelete={handleDelete} />
  );
}
