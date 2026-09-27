// Builds the small context a model sees. Budgeted, because local models on a
// 16 GB Mac do far better with 1–2k characters than with a transcript dump.

import { renderSystemPrompt, TAMAGO_PROFILE } from './personality/profile.js';

export const CONTEXT_BUDGET_CHARS = 1800;
const clip = (s, n) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);
const ago = (sec) => (sec == null ? 'first meeting' : sec < 120 ? 'moments ago' : sec < 7200 ? `${Math.round(sec / 60)} min ago`
  : sec < 172800 ? `${Math.round(sec / 3600)} h ago` : `${Math.round(sec / 86400)} days ago`);

export function buildContext({ text, cls, route, memories, turns, relationship, world, profile = TAMAGO_PROFILE }) {
  const render = (mems, trns) => {
    const sections = [];
    if (mems.length) sections.push(['OWNER MEMORY', mems.map((m) => `- ${m.text}`)]);
    if (trns.length) {
      sections.push(['THIS CONVERSATION', trns.map((t) => `${t.role === 'owner' ? 'Owner' : 'Tamago'}: ${clip(t.text || '(nonverbal)', 160)}`)]);
    }
    sections.push(['RELATIONSHIP', [`${relationship.stage}; known ${relationship.daysKnown} days; last seen ${ago(relationship.lastSeenAgoSec)}.`]]);
    sections.push(['NOW', [`${world.timeOfDay} (${world.localTime}); Tamago energy ${world.energy}.`]]);
    sections.push(['ROUTE', [`${cls.kind}${cls.complexity === 'complex' ? ', complex' : ''}; answer via ${route}.`]]);
    return sections.map(([h, lines]) => `${h}\n${lines.join('\n')}`).join('\n\n');
  };
  let mems = memories;
  let trns = turns;
  let body = render(mems, trns);
  // Enforce the budget: drop the oldest turns first, then the weakest memories.
  while (body.length > CONTEXT_BUDGET_CHARS && (trns.length > 1 || mems.length > 1)) {
    if (trns.length > 1) trns = trns.slice(1);
    else mems = mems.slice(0, -1);
    body = render(mems, trns);
  }
  const user = `OWNER SAYS: ${clip(text, 600)}`;
  return {
    system: renderSystemPrompt(profile),
    prompt: `${body}\n\n${user}`,
    stats: { chars: body.length + user.length, memories: mems.length, turns: trns.length },
  };
}
