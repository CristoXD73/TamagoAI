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
import { makeIntent, toV1Result } from './response-schema.js';
import { createDeterministicReasoner } from './reasoners/deterministic.js';
import { ProviderError } from '../providers/provider.js';

/**
 * @param {object} opts
 * @param {string} opts.dbPath          SQLite file (or ':memory:')
 * @param {object} [opts.reasoner]      createOllamaReasoner(...) or deterministic (default)
 * @param {() => number} [opts.now]
 * @param {object} [opts.profile]
 */
export async function createBrain({ dbPath, reasoner = createDeterministicReasoner(), now = Date.now, profile = TAMAGO_PROFILE } = {}) {
  const db = await openBrainDb(dbPath);
  const fallback = createDeterministicReasoner();

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

    if (route === 'rule') {
      intent = unknownFact && !refusedPrivate
        ? makeIntent({ speech: aboutMe ? "Not much yet." : "I don't know that yet.", emotion: 'uncertain', sound: 'uncertain_hum',
          haptic: 'none', behavior: 'look_away', thought: 'No memory holds that. Not guessing.' })
        : ruleIntent(cls, { relationship, world, candidates, text, memoryOps, refusedPrivate });
    } else {
      const context = buildContext({ text, cls, route, memories, turns: factRecall ? [] : turns, relationship, world, profile });
      step('context', { ...context.stats, prompt: redacted ? context.prompt.replace(/OWNER SAYS: [\s\S]*$/, `OWNER SAYS: ${redacted}`) : context.prompt });
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

    // 6b. D-123: while the Watch can't show a gesture, every reply has words.
    if (intent.speech === null && profile.behavior?.nonverbalResponseAllowed === false) {
      intent = { ...intent, speech: wordsForSilence(cls, text, relationship) };
      step('speak_instead', { reason: 'nonverbal replies are invisible on the Watch (D-123)' });
    }

    // 7. speech composer: Watch constraints regardless of which model spoke
    if (intent.speech !== null) {
      const composed = composeSpeech(intent.speech, profile);
      intent = { ...intent, speech: composed.speech, text: composed.text ?? undefined };
      step('compose', { changed: composed.changed });
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
    if (cls.kind === 'tool_request') {
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

  return {
    handle,
    /** AIProvider adapter so the existing gateway server needs no changes. */
    asProvider() {
      return {
        name: `brain(${reasoner.name})`,
        async generate(request, { signal } = {}) {
          const { v1 } = await handle(request.text, { signal, requestId: request.requestId, client: request.client });
          return v1;
        },
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
