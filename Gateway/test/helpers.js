import { createGateway } from '../src/server.js';
import { createMockProvider } from '../src/providers/mock.js';

export const TOKEN = 'test-token-0123456789abcdef';
export const ID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export async function startGateway(opts = {}) {
  const server = createGateway({
    provider: createMockProvider(),
    authToken: TOKEN,
    timeoutMs: 2000,
    ...opts,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export function textRequest(text, requestId = ID(1), extra = {}) {
  return { protocolVersion: 1, requestId, inputType: 'text', text, ...extra };
}

export async function post(base, body, { token = TOKEN, raw = false, headers = {} } = {}) {
  const res = await fetch(`${base}/v1/request`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: raw ? body : JSON.stringify(body),
  });
  return { status: res.status, headers: res.headers, body: await res.json() };
}
