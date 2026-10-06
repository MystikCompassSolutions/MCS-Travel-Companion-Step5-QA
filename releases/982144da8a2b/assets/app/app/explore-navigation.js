export function exploreFilterChoices(dayCount, todayIndex = null, selectedDayIndex = null) {
  if (!Number.isInteger(dayCount) || dayCount < 1) throw new Error('Invalid itinerary day count');
  const valid = index => Number.isInteger(index) && index >= 0 && index < dayCount;
  return [{id: 'all', label: 'All'},
    ...(valid(todayIndex) ? [{id: 'today', label: 'Today'}] : []),
    {id: 'days', label: valid(selectedDayIndex) ? `Day ${selectedDayIndex + 1} ▾` : 'Days ▾'},
    {id: 'food', label: 'Food'}, {id: 'shopping', label: 'Shopping'},
    {id: 'attraction', label: 'Attractions'}, {id: 'picks', label: 'MCS Picks'},
    {id: 'alternatives', label: 'Alternatives'}];
}
