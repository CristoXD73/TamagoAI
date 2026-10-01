// The Interaction Orchestrator: owns every interaction's lifecycle.
// The LLM is one reasoning component inside Tamago, not Tamago itself.
//
//   classify → session → extract → retrieve → relationship/world → route
//   → (rule | reasoner) → validate → compose speech → memory gate
//   → commit (turns, memories, relationship, trace) → V1 result

import { randomUUID } from 'node:crypto';
import { openBrainDb, transaction } from './storage/database.js';
import { classify, keywords as keywordsOf } from './routing/intent-router.js';
import { chooseRoute } from './routing/model-router.js';
import { deterministicResponse } from './personality/behavior-policy.js';
import { TAMAGO_PROFILE } from './personality/profile.js';
import { extractCandidates } from './memory/extractor.js';
import { gateCandidate, looksPrivate } from './memory/gate.js';
import { upsertMemory, listMemories, deleteMemory } from './memory/store.js';
import { retrieveMemories, forgetMatching, topMemories } from './memory/retrieve.js';
import { getRelationship, recordInteraction } from './relationship/model.js';
import { worldSnapshot } from './world/state.js';
import { currentSession, recentTurns, appendTurn, forgetTurns } from './session.js';
import { runMaintenance } from './maintenance.js';
import { buildContext } from './context-builder.js';
import { composeSpeech } from './speech/composer.js';
import { splitSentences, cutWords } from './speech/text.js';
import { makeIntent, toV1Result } from './response-schema.js';
import { createDeterministicReasoner } from './reasoners/deterministic.js';
import { ProviderError } from '../providers/provider.js';
import { fitDetail, HANDOFF_LIMITS } from '../handoff.js';

/**
 * @param {object} opts
 * @param {string} opts.dbPath          SQLite file (or ':memory:')
 * @param {object} [opts.reasoner]      createOllamaReasoner(...) or deterministic (default)
 * @param {() => number} [opts.now]
 * @param {object} [opts.profile]
 */
// The local model giving up ("I can't build software", "I'm not able to", "I don't know how").
// …or offering a helper in words instead of handing the work over (eval 2026-10-01).
const OFFERS_HELPER = /\b(a helper|helpers?|claude|codex|chat ?gpt)\b.{0,40}\b(can|could|will|would)\b|\b(have|ask|get) (a helper|claude|codex|chat ?gpt)\b/i;
const GAVE_UP = /\b(i (can'?t|cannot|can not|am not able to|'m not able to|am unable to|'m unable to|don'?t know how)|beyond (me|my))\b/i;

export async function createBrain({ dbPath, reasoner = createDeterministicReasoner(), now = Date.now, profile = TAMAGO_PROFILE, hands = null } = {}) {
  const db = await openBrainDb(dbPath);
  const fallback = createDeterministicReasoner();

  // D-127: the context each recent model turn used, so its long answer (detail()) knows the same things.
  const recentContexts = new Map();
  // Live test 2026-10-01 (K6/N9): a helper's full answer read back by the hands, delivered by detail() as-is.
  const storedDetails = new Map();

  async function handle(input, { signal, requestId = randomUUID(), client } = {}) {
    const started = now();
    const text = String(input).trim();
    const step = (name, data) => trace.steps.push({ name, ms: now() - started, ...data });

    // 1. understand the utterance (no model)
    const cls = classify(text);
    // Secret-looking or off-the-record words are never persisted verbatim: not as a
    // memory, not as a conversation turn, not in the trace (so no later prompt sees them).
    const privateText = looksPrivate(text);
    const redacted = privateText ? '(private, not kept)' : cls.noStore ? '(off the record)' : null;
    const trace = { requestId, at: new Date(started).toISOString(), input: redacted ?? text, client: client ?? null, steps: [] };
    step('classify', { kind: cls.kind, complexity: cls.complexity, noStore: cls.noStore, keywords: redacted ? [] : cls.keywords });

    // 2. session (closing an idle one triggers cheap maintenance)
    const { session, started: newSession, closed } = currentSession(db, started);
    if (closed) step('maintenance', runMaintenance(db, started));
    const turns = recentTurns(db, session.id);
    step('session', { id: session.id, newSession, turnsInContext: turns.length });

    // 3. candidate memories from the owner's own words
    const candidates = extractCandidates(text, { isQuestion: cls.isQuestion });

    // 4. retrieval; pronouns borrow the topic of the previous owner turn
    // (the last owner turn that had a topic; "Thanks." or "ok" carry none)
    const topicTurn = [...turns].reverse().find((t) => t.role === 'owner' && keywordsOf(t.text).some((k) => !/^(thanks|thank|buddy|cool|nice)$/.test(k)));
    const focusKeywords = (cls.usesPronoun || cls.keywords.length === 0) && topicTurn ? keywordsOf(topicTurn.text) : [];
    // "What/where/who is my…": the owner's facts come from memory, never from a model's guess
    // or from older conversation lines (a small model copies a stale answer from those).
    const aboutMe = cls.isQuestion && /\bwhat do you (know|remember)\b|\b(know|remember) about me\b/i.test(text);
    const factRecall = aboutMe || (cls.kind === 'recall' && cls.complexity === 'simple' && /^(what|what's|whats|where|where's|who|who's|which|when)\b/i.test(text));
    const memories = cls.kind === 'forget' ? []
      : aboutMe ? topMemories(db)
        : retrieveMemories(db, { keywords: [...cls.keywords, ...focusKeywords], now: started });
    step('retrieve', { focusKeywords, factRecall, memories: memories.map((m) => ({ id: m.id, text: m.text, score: +m.score.toFixed(2), matched: m.matched })) });

    // 5. who and when
    const relationship = getRelationship(db, started);
    if (reasoner.checkHealth) await reasoner.checkHealth({ signal });
    const world = worldSnapshot({ now: started, relationship, reasoner, sessionTurns: session.turns });
    step('state', { relationship, world });

    // 6. how much thinking does this deserve? (rule-extracted facts are gated first,
    //    so Tamago never says "Got it" about something it refused to keep)
    const ruleGated = candidates.map((c) => ({ c, g: gateCandidate(c, { noStore: cls.noStore }) }));
    const accepted = ruleGated.filter(({ g }) => g.decision === 'accept').length;
    const refusedPrivate = privateText || ruleGated.some(({ g }) => g.reason === 'private/secret-like content');
    // A secret never reaches a model, whatever kind of utterance carried it.
    const unknownFact = factRecall && !memories.some((m) => m.matched);
    let route = refusedPrivate || unknownFact ? 'rule' : chooseRoute(cls, { extractedFacts: accepted || (cls.noStore ? candidates.length : 0) });
    let intent;
    let reasonerUsed = 'rule';
    const memoryOps = [];

    // 6a. D-128: Tamago's hands. A command about the Mac ("open Steam", "volume 30") or the owner's answer to a
    // pending "Quit Safari? Say yes to go." goes to the tool loop. Never for private text. If Ollama is down,
    // the honest rule answer below says so.
    let handsOut = null;
    if (hands && !privateText) {
      try {
        handsOut = await hands.handle(text, cls, { signal });
      } catch (err) {
        if (signal?.aborted) throw err;
        step('hands', { error: err.message });
        if (cls.kind === 'hands') {
          handsOut = { speech: "My hands aren't answering right now.", emotion: 'uncertain', behavior: 'look_away', thought: `Hands failed: ${err.message}`, steps: [] };
        }
      }
    }
    if (handsOut) {
      route = 'hands';
      reasonerUsed = 'hands';
      intent = makeIntent({ speech: handsOut.speech, emotion: handsOut.emotion ?? 'content', behavior: handsOut.behavior ?? 'settle',
        haptic: 'click', followUpExpected: handsOut.followUpExpected === true, thought: handsOut.thought ?? '' });
      step('hands', { steps: handsOut.steps ?? [], pending: hands.pending });
    } else if (route === 'rule') {
      intent = unknownFact && !refusedPrivate
        ? makeIntent({ speech: aboutMe ? "Not much yet." : "I don't know that yet.", emotion: 'uncertain', sound: 'uncertain_hum',
          haptic: 'none', behavior: 'look_away', thought: 'No memory holds that. Not guessing.' })
        : ruleIntent(cls, { relationship, world, candidates, text, memoryOps, refusedPrivate });
    } else {
      const context = buildContext({ text, cls, route, memories, turns: factRecall ? [] : turns, relationship, world, profile });
      step('context', { ...context.stats, prompt: redacted ? context.prompt.replace(/OWNER SAYS: [\s\S]*$/, `OWNER SAYS: ${redacted}`) : context.prompt });
      recentContexts.set(requestId, context.prompt.replace(/\n\nOWNER SAYS:[\s\S]*$/, ''));
      while (recentContexts.size > 8) recentContexts.delete(recentContexts.keys().next().value);
      let active = reasoner.available === false ? fallback : reasoner;
      try {
        const r = await active.reason({ context, route, text, cls, memories, focusKeywords }, { signal });
        intent = r.intent;
        reasonerUsed = `${active.name}${r.model ? `:${r.model}` : ''}`;
        step('reason', { reasoner: reasonerUsed, attempts: r.attempts });
      } catch (err) {
        if (signal?.aborted) throw err;
        if (err instanceof ProviderError && err.code === 'provider_unavailable' && active !== fallback) {
          active = fallback;
          const r = await fallback.reason({ context, route, text, cls, memories, focusKeywords }, { signal });
          intent = r.intent;
          reasonerUsed = 'deterministic (model unavailable)';
          step('reason', { reasoner: reasonerUsed, fallbackReason: err.message });
        } else {
          throw err;
        }
      }
    }

    let escOut = null;
    // A question about Tamago itself ("what can you do?") may name the helpers without asking for one.
    const aboutTamago = cls.isQuestion && /\byou(r|rself)?\b/i.test(text);
    // 6a'. Escalation (owner, 2026-10-01: "a way to speak with Claude, Codex or ChatGPT when it cannot deal with the
    // demand"). When the local model gives up on a real request, the hands get it: they can offer a helper.
    // Review round 2 (RV2-4): never for off-the-record words (nothing of them may reach a helper).
    if (hands && !handsOut && !privateText && !cls.noStore && reasonerUsed !== 'hands' && (GAVE_UP.test(intent.speech ?? '') || (OFFERS_HELPER.test(intent.speech ?? '') && !aboutTamago))
        && ['question', 'statement', 'tool_request', 'live_info'].includes(cls.kind) && !unknownFact) {
      try {
        const esc = await hands.handle(text, { ...cls, kind: 'hands' }, { signal });
        if (esc) {
          escOut = esc;
          route = 'escalated';
          reasonerUsed = 'hands (escalated)';
          intent = makeIntent({ speech: esc.speech, emotion: esc.emotion ?? 'curious', behavior: esc.behavior ?? 'settle',
            haptic: 'click', followUpExpected: esc.followUpExpected === true, thought: `Local model gave up; ${esc.thought ?? ''}` });
          step('escalate', { steps: esc.steps ?? [], pending: hands.pending });
        }
      } catch (err) {
        step('escalate', { error: err.message });
      }
    }

    // 6b. D-123: while the Watch can't show a gesture, every reply has words.
    if (intent.speech === null && profile.behavior?.nonverbalResponseAllowed === false) {
      intent = { ...intent, speech: wordsForSilence(cls, text, relationship) };
      step('speak_instead', { reason: 'nonverbal replies are invisible on the Watch (D-123)' });
    }

    // 7. speech composer: Watch constraints regardless of which model spoke
    const extra = handsOut ?? escOut;
    if (intent.speech !== null) {
      // R2T-R3-H6: the hands' rule text quotes the owner; only a model's wording goes through the assistant filters.
      const composed = composeSpeech(intent.speech, profile, { verbatim: extra?.verbatim === true });
      intent = { ...intent, speech: composed.speech, text: composed.text ?? undefined };
      step('compose', { changed: composed.changed });
    }

    // 7a. Helper facts for the screen and the phone (live test 2026-10-01: K6/N9, K7). `screen` is the tools' full
    // text (status with every task, the run command); `detail` is a helper's whole answer, sent as a long answer.
    if (extra?.screen && intent.speech !== null) intent = { ...intent, text: plainScreen(extra.screen) };
    if (extra?.detail) {
      storedDetails.set(requestId, String(extra.detail));
      while (storedDetails.size > 8) storedDetails.delete(storedDetails.keys().next().value);
      // Review round 3 (R2T-R3-H2): a status that carries a helper's whole answer keeps its list on the phone, above it.
      intent = { ...intent, needsDetail: true, ...(extra.offer ? { offer: extra.offer } : {}), ...(extra.detailUnder ? { detailUnder: true } : {}) };
    }

    // 7b. News from the helpers (K2/N1, RELAY_PLAN R3 without push): an ending the owner hasn't heard yet (a
    // question, a finish, a limit) is told on their next interaction of any kind, by rule. Spoken only within the
    // Watch's speech limit; a confirmation waiting for "yes" is never displaced (the news waits a turn).
    const news = hands && !privateText && intent.speech !== null ? (hands.news?.() ?? null) : null;
    if (news?.length) {
      const merged = mergeNews(intent, news, profile.communication.maxSpeechChars);
      if (merged.told.length) {
        intent = { ...intent, speech: merged.speech, text: merged.text };
        hands.announce?.(merged.told);
        // R5: a read-only helper's whole answer told as news goes to the phone like relay_result's (the long-answer
        // offer). mergeNews only tells such news on a reply that isn't already waiting for a yes or a long answer.
        if (merged.detail) {
          storedDetails.set(requestId, merged.detail);
          while (storedDetails.size > 8) storedDetails.delete(storedDetails.keys().next().value);
          intent = { ...intent, needsDetail: true, detailUnder: true, ...(merged.offer ? { offer: merged.offer } : {}) };
        }
      }
      step('news', { told: merged.told, waiting: news.length - merged.told.length });
    }

    // 8. memory write gate (rules + any model proposals)
    const gated = [...ruleGated, ...intent.memoryCandidates.map((c) => ({ ...c, key: null, source: 'llm' }))
      .map((c) => ({ c, g: gateCandidate(c, { noStore: cls.noStore }) }))];
    step('memory_gate', { decisions: gated.map(({ c, g }) => ({
      text: redacted || g.reason === 'private/secret-like content' ? '[redacted]' : c.text, source: c.source, ...g,
    })) });

    if (signal?.aborted) throw signal.reason ?? new Error('aborted'); // never commit a stale interaction

    // 9. commit atomically
    const said = intent.speech ?? '';
    transaction(db, () => {
      for (const { c, g } of gated) {
        if (g.decision === 'accept') memoryOps.push({ op: upsertMemory(db, c, started).action, text: c.text });
      }
      appendTurn(db, session.id, started, redacted ?? text, said, { emotion: intent.emotion, behavior: intent.behavior, route });
      recordInteraction(db, cls.kind, started);
    });
    step('commit', { memoryOps });

    const v1 = toV1Result(intent);
    Object.assign(trace, {
      route, reasoner: reasonerUsed, intent, v1, memoryOps,
      relationshipAfter: getRelationship(db, now()), totalMs: now() - started,
    });
    db.prepare('INSERT INTO traces (at, request_id, trace) VALUES (?, ?, ?)').run(started, requestId, JSON.stringify(trace));
    return { intent, v1, trace };
  }

  function ruleIntent(cls, { relationship, world, candidates, text, memoryOps, refusedPrivate }) {
    const policy = deterministicResponse(cls, { relationship, world });
    if (policy) return policy;
    if (cls.kind === 'forget') {
      const topic = cls.keywords.filter((k) => !/^(forget|erase|delete|remove|told|about|that)$/.test(k));
      const { removed, turns } = transaction(db, () => ({ removed: forgetMatching(db, topic), turns: forgetTurns(db, topic) }));
      for (const r of removed) memoryOps.push({ op: 'forgotten', text: r.text });
      if (turns) memoryOps.push({ op: 'forgotten_turns', text: `${turns} conversation turns` });
      return makeIntent(removed.length || turns
        ? { speech: 'Okay. Forgotten.', emotion: 'content', haptic: 'click', behavior: 'slow_blink', thought: `Forgot ${removed.length} memories.` }
        : { speech: "I didn't have that.", emotion: 'uncertain', haptic: 'none', behavior: 'look_away', thought: 'Nothing matched.' });
    }
    if (cls.kind === 'forbidden') {
      const what = { delete: 'Deleting things', send: 'Sending messages for you', pay: 'Money', secret: 'Passwords and admin rights',
        install: 'Installing software' }[cls.forbidden] ?? 'That';
      return makeIntent({ speech: `I won't do that. ${what} stays with you.`, emotion: 'uncertain', haptic: 'none',
        behavior: 'look_away', thought: `Forbidden action (${cls.forbidden}): never attempted, whatever the wording.` });
    }
    if (cls.kind === 'live_info') {
      return makeIntent({ speech: "I can't check that yet.", emotion: 'uncertain', sound: 'uncertain_hum', haptic: 'none',
        behavior: 'look_away', thought: 'Live information (weather, news, service status) needs tools (Brain E).' });
    }
    if (cls.kind === 'time') {
      const [h, m] = world.localTime.split(':').map(Number);
      const part = { night: 'Night', early_morning: 'Early morning', morning: 'Morning', afternoon: 'Afternoon',
        evening: 'Evening', late_evening: 'Late evening' }[world.timeOfDay];
      return makeIntent({ speech: `It's ${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}. ${part} here.`, emotion: 'content',
        haptic: 'none', behavior: 'settle', thought: 'The clock is known; no model needed.' });
    }
    if (cls.kind === 'tool_request' || cls.kind === 'hands') {
      return makeIntent({ speech: "I can't do that yet.", emotion: 'uncertain', sound: 'uncertain_hum', haptic: 'none',
        behavior: 'look_away', thought: `Tool request "${text}" — tools arrive in Brain E.` });
    }
    // A statement that taught a fact: acknowledge briefly (nonverbal once familiar)
    if (refusedPrivate) {
      return makeIntent({ speech: "I don't keep secrets like that.", emotion: 'focused', sound: 'uncertain_hum', haptic: 'none',
        behavior: 'retreat_slightly', thought: 'Secret-like content refused by the memory gate.' });
    }
    if (cls.noStore) {
      return makeIntent({ speech: "Okay. I won't keep that.", emotion: 'content', haptic: 'click', behavior: 'settle', thought: 'Off the record.' });
    }
    const familiar = relationship.stage === 'familiar' || relationship.stage === 'bonded';
    return makeIntent(familiar
      ? { speech: null, emotion: 'content', sound: 'soft_ack', haptic: 'click', behavior: 'slow_blink', thought: `Learned: ${candidates[0]?.text}` }
      : { speech: 'Got it.', emotion: 'content', sound: 'soft_ack', haptic: 'click', behavior: 'settle', thought: `Learned: ${candidates[0]?.text}` });
  }

  // Short in-character words for the moments Tamago would otherwise only gesture (D-123).
  function wordsForSilence(cls, text, relationship) {
    const warm = relationship.stage === 'familiar' || relationship.stage === 'bonded';
    if (/\b(hear|hearing) me\b|\byou there\b|\bare you (awake|listening|here)\b/i.test(text)) return 'I hear you.';
    switch (cls.kind) {
      case 'greeting': return relationship.stage === 'new' ? 'Oh. Hi.' : 'Hi.';
      case 'gratitude': return warm ? 'Anytime.' : 'Mm. Sure.';
      case 'affirmation': return 'Mm-hm.';
      case 'statement': return 'Got it.';
      default: return cls.isQuestion ? "Hm. I'm not sure." : "I'm here.";
    }
  }

  /** D-127: the full answer behind a `needsDetail` reply, written by the reasoner (never spoken as-is). */
  async function detail(request, { gist, signal } = {}) {
    // K6/N9: a helper's own answer is passed on as it is; no model rewrites it.
    if (storedDetails.has(request.requestId)) {
      const d = storedDetails.get(request.requestId);
      storedDetails.delete(request.requestId);
      return d;
    }
    const context = recentContexts.get(request.requestId);
    recentContexts.delete(request.requestId);
    if (typeof reasoner.detail !== 'function') throw new ProviderError('provider_error', 'No long answer for this reply.');
    return reasoner.detail({ question: request.text, gist, context }, { signal });
  }

  return {
    handle,
    detail,
    /** AIProvider adapter so the existing gateway server needs no changes. */
    asProvider() {
      return {
        name: `brain(${reasoner.name})`,
        async generate(request, { signal } = {}) {
          const { v1 } = await handle(request.text, { signal, requestId: request.requestId, client: request.client });
          return v1;
        },
        ...(typeof reasoner.detail === 'function' || hands ? { detail } : {}),
      };
    },
    lastTrace() {
      const r = db.prepare('SELECT trace FROM traces ORDER BY id DESC LIMIT 1').get();
      return r ? JSON.parse(r.trace) : null;
    },
    memories: (opts) => listMemories(db, opts),
    forget: (id) => deleteMemory(db, id),
    relationship: () => getRelationship(db, now()),
    reasoner,
    close: () => db.close(),
  };
}

/** Whole lines within `max` characters, with "…" when some were left out (R9: never cut mid-word or mid-path). */
function cutLines(s, max) {
  const lines = String(s).split('\n');
  if (String(s).length <= max) return String(s);
  const out = [];
  for (const l of lines) {
    if ([...out, l].join('\n').length > max - 2) break;
    out.push(l);
  }
  return out.length ? `${out.join('\n')}\n…` : cutWords(lines[0], max);
}

/**
 * Screen text from the hands' tools: plain lines, within the reply limit. R9: only markdown emphasis and heading/quote
 * markers go, and never from a recorded "Run it:" command (tests/*, 2>/dev/null stay as written).
 */
export function plainScreen(s, max = 900) {
  const plain = (x) => x.replace(/\*\*|__|`/g, '').replace(/^\s*(#+|>+)\s*/, '').replace(/[ \t]+/g, ' ').trim();
  const lines = String(s).split('\n').map((l) => {
    const at = l.indexOf('Run it: ');
    return at < 0 ? plain(l) : `${plain(l.slice(0, at))} ${l.slice(at).trim()}`.trim();
  });
  return cutLines(lines.join('\n'), max);
}

const SCREEN_MAX = 1000;   // the protocol's reply text limit

/**
 * K2/N1: news first (it's what the owner didn't know), then the reply. Items are added while they fit the speech
 * limit. Review 2026-10-01: a reply waiting for "yes" never carries a helper's question (SM8, G10: the owner's yes
 * would go to the wrong one), and a reply with a long answer for the phone carries no news (R6: the server adds its
 * own yes/no offer and replaces the turn's text). If nothing fits next to the reply, one item is spoken (its short
 * form if needed) with the reply's first sentence, never in place of the reply (R7), or the news waits a turn.
 * Review round 2: the reply's own screen text is always kept whole, and news lines get what room is left (L6); a
 * helper's whole answer told next to another reply keeps that reply above it on the phone and names the helper in the
 * offer (L4: the phone turn lost "Steam is opening.").
 * Review round 3 (R2T-R3-H1, H3): a news item that carries a helper's whole answer is told only when that answer goes
 * to the phone with it: never on a reply waiting for "yes", and one per reply (the others stay news). The detail is
 * the answer alone, fitted on its own; the phone shows it under the whole merged screen (`detailUnder`), so the reply
 * and every other news line (a Codex finish, its "Run it:") stay there, and "say it all" reads only the answer.
 * @returns {{ speech: string, text: string, told: string[], detail?: string, offer?: string }}
 */
export function mergeNews(intent, news, max) {
  const reply = intent.speech;
  const screen = intent.text ?? reply;
  const none = { speech: reply, text: screen, told: [] };
  if (intent.needsDetail) return none;
  let withDetail = false;
  const pool = news.filter((n) => !(intent.followUpExpected && n.kind === 'question')
    && (!n.detail || (!intent.followUpExpected && !withDetail && (withDetail = true))));
  const told = [];
  const spoken = [];
  for (const n of pool) {
    if (`${[...spoken, n.speech].join(' ')} ${reply}`.length <= max) { told.push(n); spoken.push(n.speech); } else break;
  }
  let speech;
  if (told.length) {
    speech = `${spoken.join(' ')} ${reply}`;
  } else {
    if (intent.followUpExpected || !pool.length) return none;
    const n = pool[0];
    const first = splitSentences(reply)[0] ?? reply;
    const line = [n.speech, n.short].filter(Boolean).find((x) => `${x} ${first}`.length <= max);
    if (!line) return none;
    told.push(n);
    speech = `${line} ${first}`;
  }
  const room = SCREEN_MAX - screen.length - 1;
  const text = room >= 40 ? `${cutLines(told.map((n) => n.text).join('\n'), room)}\n${screen}` : screen;
  // R5: a whole answer for the phone, only when this reply isn't itself waiting for a yes (the pool has no other).
  const n = told.find((x) => x.detail);
  const detail = n ? fitDetail(n.detail, n.log, HANDOFF_LIMITS.maxDetailChars) : null;
  return { speech, text, told: told.map((x) => x.id), ...(detail ? { detail, ...(n.offer ? { offer: n.offer } : {}) } : {}) };
}