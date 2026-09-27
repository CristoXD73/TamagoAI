// Deterministic familiarity. Earned by presence across days, not by volume.
// Never decreases: absence changes nothing here (CREATURE_SPEC §6).

const DAY = 86_400_000;
export const STAGES = [
  { stage: 'new', minCredits: 0 },
  { stage: 'recognizing', minCredits: 2 },
  { stage: 'familiar', minCredits: 5 },
  { stage: 'bonded', minCredits: 14 },
];
const MAX_QUALITY_PER_DAY = 0.5;
const QUALITY = { gratitude: 0.2, greeting: 0.1, statement: 0.15, recall: 0.1, question: 0.1 };

const localDay = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function stageFor(credits) {
  let s = STAGES[0].stage;
  for (const st of STAGES) if (credits >= st.minCredits) s = st.stage;
  return s;
}

export function getRelationship(db, now) {
  const r = db.prepare('SELECT * FROM relationship WHERE id = 1').get();
  if (!r) {
    return { stage: 'new', credits: 0, daysKnown: 0, meaningfulInteractions: 0, lastSeenAgoSec: null, firstMeeting: true };
  }
  return {
    stage: stageFor(r.credits),
    credits: Math.round(r.credits * 100) / 100,
    daysKnown: Math.floor((now - r.first_seen) / DAY),
    meaningfulInteractions: r.meaningful_interactions,
    lastSeenAgoSec: Math.round((now - r.last_seen) / 1000),
    firstMeeting: false,
  };
}

/**
 * Records one completed interaction. A day earns 1 presence credit on its
 * first meaningful interaction, plus a small capped quality bonus.
 */
export function recordInteraction(db, kind, now) {
  const today = localDay(now);
  const r = db.prepare('SELECT * FROM relationship WHERE id = 1').get();
  if (!r) {
    db.prepare(`INSERT INTO relationship (id, first_seen, last_seen, credits, credit_day, day_interactions, day_quality, meaningful_interactions)
      VALUES (1, ?, ?, 1, ?, 1, 0, 1)`).run(now, now, today);
    return;
  }
  let { credits, day_interactions: dayN, day_quality: dayQ, credit_day: creditDay } = r;
  if (creditDay !== today) {
    credits += 1;
    dayN = 0;
    dayQ = 0;
    creditDay = today;
  }
  const bonus = Math.min(QUALITY[kind] ?? 0, MAX_QUALITY_PER_DAY - dayQ);
  if (bonus > 0) {
    credits += bonus;
    dayQ += bonus;
  }
  db.prepare(`UPDATE relationship SET last_seen = ?, credits = ?, credit_day = ?, day_interactions = ?, day_quality = ?,
      meaningful_interactions = meaningful_interactions + 1 WHERE id = 1`).run(now, credits, creditDay, dayN + 1, dayQ);
}
