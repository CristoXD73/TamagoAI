// monitor.js: the owner's live view of Tamago's conversations (TAMAGO_MONITOR=1).
//
// Prints each hop on the owner's own terminal as it happens: the Watch checking
// in, the audio arriving, what the Mac heard, what Tamago answered, the voice
// being made and the Watch fetching it. It shows the words, so it's opt-in and
// terminal-only: nothing here is written to a file, and the JSON logger stays
// metadata-only (AGENTS.md privacy rules). Owner's request, 2026-09-27: "i need
// to see where those texts/voice arrive so i can visible debug".

const COLORS = { dim: 2, red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36 };

/**
 * @param {object} [opts]
 * @param {(line: string) => void} [opts.write]  default console.log
 * @param {boolean} [opts.color]                  ANSI colours, default: stdout is a TTY
 * @returns {(event: object) => void}             pass as createGateway({ monitor })
 */
export function createConsoleMonitor({ write = (line) => console.log(line), color = Boolean(process.stdout.isTTY) } = {}) {
  const paint = (name, s) => (color ? `\x1b[${COLORS[name]}m${s}\x1b[0m` : s);
  let lastHealth = { from: null, at: 0 };

  return function monitor(e) {
    const time = paint('dim', new Date(e.at ?? Date.now()).toLocaleTimeString('en-GB'));
    const id = e.requestId ? paint('dim', `#${e.requestId.slice(0, 4)}`) : '     ';
    const line = (icon, what, detail = '') => write(`${time} ${id} ${icon} ${what}${detail ? `  ${paint('dim', detail)}` : ''}`);
    const quote = (s) => `“${s}”`;
    const from = e.from ? `from ${e.from}` : '';

    switch (e.kind) {
      case 'health':
        if (e.from === '127.0.0.1' || e.from === '::1') return;
        // The Watch checks in each time Tamago comes to the front; one line per minute is plenty.
        if (e.from === lastHealth.from && e.at - lastHealth.at < 60_000) return;
        lastHealth = { from: e.from, at: e.at };
        return line('⌚', paint('blue', 'Watch checked in'), from);
      case 'pair':
        return line('🔗', e.outcome === 'ok' ? paint('green', `Paired ${e.deviceName ?? 'a Watch'}`) : paint('red', `Pairing ${e.outcome}`), from);
      case 'auth_failed':
        return line('⛔', paint('red', `Rejected ${e.route}: wrong or missing token`), `${from} · re-pair the Watch`);
      case 'audio_in':
        return line('🎤', paint('cyan', `Voice arrived (${kb(e.bytes)})`), [from, e.duplicate && 'retry, same answer'].filter(Boolean).join(' · '));
      case 'text_in':
        return line('💬', `${paint('cyan', 'Typed:')} ${quote(e.text)}`, [from, e.duplicate && 'retry, same answer'].filter(Boolean).join(' · '));
      case 'heard':
        return e.text
          ? line('👂', `${paint('cyan', 'Heard:')} ${quote(e.text)}`, secs(e.ms))
          : line('👂', paint('yellow', 'Heard nothing usable'), secs(e.ms));
      case 'heard_failed':
        return line('👂', paint('red', `Transcription failed: ${e.message}`), secs(e.ms));
      case 'reply':
        return line('🐙', `${paint('green', 'Tamago:')} ${quote(e.text)}`, `${e.characterState} · ${secs(e.ms)}`);
      case 'reply_error':
        return line('🐙', paint('red', `No answer: ${e.code}${e.message ? ` (${e.message})` : ''}`), secs(e.ms));
      case 'voice_ready':
        return line('🔊', paint('magenta', `Voice ready (${e.voice}, ${kb(e.bytes)})`), secs(e.ms));
      case 'voice_failed':
        return line('🔊', paint('red', `Voice failed: ${e.code ?? ''} ${e.message ?? ''}`.trim()), `${secs(e.ms)} · the Watch speaks it itself`);
      case 'voice_fetch':
        if (e.status === 200) return line('📲', paint('magenta', 'Watch fetched the voice'), `waited ${secs(e.waitedMs)}`);
        return line('📲', paint('yellow', `Watch asked for the voice: ${e.status === 404 ? 'gone or never made' : `not ready (${e.state})`}`), 'the Watch speaks it itself');
      case 'warn':
        return line('⚠️ ', paint('yellow', e.message ?? e.event));
      case 'error':
        return line('❌', paint('red', e.message ?? e.event));
      default:
        return undefined;
    }
  };
}

/**
 * JSON logger for monitor mode: metadata lines go to `file` (if any) instead of
 * cluttering the live view; warnings and errors still show on the terminal.
 */
export function createMonitorLogger({ monitor, appendLine = null }) {
  const emit = (level, o) => {
    appendLine?.(JSON.stringify({ level, t: new Date().toISOString(), ...o }));
    if (level === 'info') return;
    // These already have their own monitor line.
    if (['request', 'audio', 'speech', 'speech_synth_failed', 'transcribe_failed'].includes(o.event)) return;
    monitor({ kind: level, event: o.event, message: o.message ?? o.event });
  };
  return { info: (o) => emit('info', o), warn: (o) => emit('warn', o), error: (o) => emit('error', o) };
}

function secs(ms) {
  return typeof ms === 'number' ? `${(ms / 1000).toFixed(1)} s` : '';
}

function kb(bytes) {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
