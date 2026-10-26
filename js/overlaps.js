export function periodsOverlap(a, b) {
  return a.start <= b.end && b.start <= a.end;
}

export function overlappingPersonIds(period, allPeriods) {
  const others = new Set();
  for (const p of allPeriods) {
    if (p.id === period.id || p.personId === period.personId) continue;
    if (periodsOverlap(period, p)) others.add(p.personId);
  }
  return others;
}

export function addDaysISO(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export function eachDateISO(startISO, endISO) {
  const out = [];
  let cur = startISO;
  let guard = 0;
  while (cur <= endISO && guard < 5000) {
    out.push(cur);
    cur = addDaysISO(cur, 1);
    guard++;
  }
  return out;
}

// Map<dateISO, Set<personId>> of who is away on each day in [startISO, endISO]
export function dailyAwayMap(periods, startISO, endISO) {
  const map = new Map();
  for (const day of eachDateISO(startISO, endISO)) map.set(day, new Set());
  for (const p of periods) {
    const from = p.start > startISO ? p.start : startISO;
    const to = p.end < endISO ? p.end : endISO;
    if (from > to) continue;
    for (const day of eachDateISO(from, to)) {
      map.get(day)?.add(p.personId);
    }
  }
  return map;
}
