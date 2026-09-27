// OFFLINE FALLBACK + TEST DOUBLE. Not intelligence: it answers only from
// structured memories and otherwise reacts nonverbally, in character. It lets
// the whole brain run (and be tested) with no model installed.

import { makeIntent } from '../response-schema.js';

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function answerFrom(m, q) {
  const prep = (m.text.match(/\bruns (on|in|at)\b/i) ?? [null, 'on'])[1];
  if (m.relation === 'runs_on' && /\bwhere\b/.test(q)) return `${cap(prep)} ${m.value}.`;
  if (m.relation === 'runs_on') return `It runs on ${m.value}.`;
  if (m.relation === 'name' && /\bname\b|\bwho am i\b/.test(q)) return `You're ${m.value}.`;
  if (m.relation === 'is') return `${cap(m.value)}.`;
  if (m.relation === 'has') return `You have ${m.value}.`;
  if (m.relation === 'response_length') return 'Short answers. Like this.';
  return m.text.replace(/^Owner's\b/, 'Your').replace(/^Owner\b/, 'You');
}

export function createDeterministicReasoner() {
  return {
    name: 'deterministic',
    available: true,
    async reason({ text, cls, memories, focusKeywords = [] }) {
      const q = text.toLowerCase();
      if (/\b(running|up|working|behaving|alive|down|online|offline|healthy|broken)\b/.test(q) && cls.isQuestion) {
        return { intent: makeIntent({ speech: "I can't check that yet.", emotion: 'uncertain', sound: 'uncertain_hum',
          haptic: 'none', behavior: 'look_away', thought: 'Status questions need tools (Brain E).' }), attempts: 1 };
      }
      if (cls.kind === 'recall' || cls.kind === 'question') {
        const kw = new Set([...cls.keywords, ...focusKeywords]);
        const hit = memories.find((m) => m.subject && [...kw].some((k) => m.subject.includes(k) || k.includes(m.subject)))
          ?? memories.find((m) => m.type !== 'preference');
        if (hit) {
          return { intent: makeIntent({ speech: answerFrom(hit, q), emotion: 'content', haptic: 'click', behavior: 'settle',
            thought: `Answered from memory #${hit.id}.` }), attempts: 1 };
        }
        return { intent: makeIntent({ speech: "I don't know that yet.", emotion: 'uncertain', sound: 'uncertain_hum',
          haptic: 'none', behavior: 'look_away', thought: 'No memory matches and no model is available.' }), attempts: 1 };
      }
      return { intent: makeIntent({ speech: null, emotion: 'curious', sound: 'curious_trill', haptic: 'none',
        behavior: 'inspect_owner', thought: 'No model available; listening instead of pretending.' }), attempts: 1 };
    },
  };
}
