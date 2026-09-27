// Chooses how much thinking an interaction deserves:
//   rule  -> no model at all (behavior policy / memory ops)
//   fast  -> small model, short context
//   smart -> larger model for genuinely complex questions

export function chooseRoute(cls, { extractedFacts = 0 } = {}) {
  switch (cls.kind) {
    case 'gratitude':
    case 'affirmation':
    case 'greeting':
    case 'forget':
    case 'tool_request':        // tools arrive in Brain E; answered honestly by rule until then
      return 'rule';
    case 'statement':
      return extractedFacts > 0 ? 'rule' : 'fast';
    case 'recall':
    case 'question':
      return cls.complexity === 'complex' ? 'smart' : 'fast';
    default:
      return 'fast';
  }
}
