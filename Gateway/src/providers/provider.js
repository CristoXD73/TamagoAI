// AIProvider contract (duck-typed):
//
//   {
//     name: string,
//     generate(request, { signal }) => Promise<{
//       text: string,
//       speechText?: string,
//       characterState?: 'idle' | 'happy' | 'success' | 'confused' | 'error',
//       haptic?: 'none' | 'click' | 'success' | 'failure' | 'notification' | 'retry',
//       followUpExpected?: boolean,
//     }>
//   }
//
// `request` is the normalized protocol request from protocol.parseRequest.
// Providers must honour `signal` (AbortSignal) so the gateway timeout actually
// stops work. To fail with a specific protocol error, throw ProviderError; any
// other exception is reported to the client as a generic provider_error and its
// message is not forwarded (it may contain model or host details).

export class ProviderError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
  }
}

export function abortableDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal.reason ?? new Error('aborted'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
