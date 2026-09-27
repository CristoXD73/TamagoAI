// Deterministic responses for interactions that never need a model.
// These are the cheapest and most "creature-like" replies Tamago has.

import { makeIntent } from '../response-schema.js';

/**
 * @param {object} cls        intent-router classification
 * @param {object} ctx        { relationship, world }
 * @returns {object|null}     a TamagoIntent, or null if a model should decide
 */
export function deterministicResponse(cls, { relationship, world }) {
  const warm = relationship.stage === 'familiar' || relationship.stage === 'bonded';
  const sleepy = world.energy < 0.35;
  switch (cls.kind) {
    case 'gratitude':
      return makeIntent({
        speech: null, emotion: warm ? 'affectionate' : 'pleased', sound: warm ? 'tiny_chirp' : 'soft_ack',
        haptic: 'click', behavior: warm ? 'settle_close' : 'settle', thought: 'Thanked. A gesture is enough.',
      });
    case 'affirmation':
      return makeIntent({
        speech: null, emotion: 'content', sound: 'soft_ack', haptic: 'none', behavior: 'slow_blink',
        thought: 'Acknowledgement needs no words.',
      });
    case 'greeting':
      if (relationship.stage === 'new') {
        return makeIntent({
          speech: null, emotion: 'curious', sound: 'curious_trill', haptic: 'click', behavior: 'inspect_owner',
          thought: 'Still getting to know this person. Watch first.',
        });
      }
      return makeIntent({
        speech: sleepy ? 'Mm. Hi.' : 'Hi.', emotion: sleepy ? 'sleepy' : 'pleased', sound: 'soft_ack',
        haptic: 'click', behavior: 'perk_up', thought: 'Owner said hello.',
      });
    default:
      return null;
  }
}
