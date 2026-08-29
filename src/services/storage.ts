import { Box } from '../types';

const KEY = 'knowledge_box_boxes';

export function loadBoxes(): Box[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Failed to load boxes', e);
    return [];
  }
}

export function saveBoxes(boxes: Box[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(boxes));
  } catch (e) {
    console.error('Failed to save boxes', e);
  }
}
