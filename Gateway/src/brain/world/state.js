// What is true right now. Distinct from memory: nothing here is "learned".

export function timeOfDay(hour) {
  if (hour < 5) return 'night';
  if (hour < 9) return 'early_morning';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'late_evening';
}

// Circadian energy curve from CREATURE_SPEC §2.1: low 03:00, high 10:00–16:00.
export function energyAt(hour) {
  const pts = [[0, 0.35], [3, 0.25], [7, 0.5], [10, 0.8], [16, 0.8], [21, 0.5], [24, 0.35]];
  for (let i = 1; i < pts.length; i++) {
    const [h1, e1] = pts[i];
    const [h0, e0] = pts[i - 1];
    if (hour <= h1) return +(e0 + ((e1 - e0) * (hour - h0)) / (h1 - h0)).toFixed(2);
  }
  return 0.35;
}

export function worldSnapshot({ now, relationship, reasoner, sessionTurns }) {
  const d = new Date(now);
  const hour = d.getHours() + d.getMinutes() / 60;
  return {
    localTime: d.toTimeString().slice(0, 5),
    timeOfDay: timeOfDay(hour),
    energy: energyAt(hour),
    lastInteractionAgoSec: relationship.lastSeenAgoSec,
    reasoner: reasoner.name,
    reasonerAvailable: reasoner.available !== false,
    sessionTurns,
  };
}
