export function adjacentDayIndex(current, direction, count) {
  if (!Number.isInteger(current) || !Number.isInteger(direction) || !Number.isInteger(count) || count < 1) {
    throw new Error('Invalid itinerary day navigation');
  }
  return Math.max(0, Math.min(count - 1, current + direction));
}

export function swipeDayDirection(start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.25) return 0;
  return dx < 0 ? 1 : -1;
}
