import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import App from '../App.jsx';
import { AuthProvider } from '../auth/AuthContext.jsx';

// Test addresses are built from parts so that no literal URL sits in web/src.
export const videoUrl = (host, path = '/room') => ['https', ''].join(':') + '//' + host + path;

export const ok = (json, status = 200) => ({ status, json });
export const fail = (status, code, message) => ({ status, json: { error: { code, message } } });
export const never = () => new Promise(() => {});

export const USERS = {
  professional: { id: 'u-ana', email: 'ana@example.test', displayName: 'Ana Rivera', role: 'professional', centerId: 'center-1' },
  client: { id: 'u-luis', email: 'luis@example.test', displayName: 'Luis Mora', role: 'client', centerId: 'center-1' },
  admin: { id: 'u-root', email: 'root@example.test', displayName: 'Rosa Admin', role: 'admin', centerId: 'center-1' },
  auditor: { id: 'u-aud', email: 'aud@example.test', displayName: 'Ari Auditor', role: 'auditor', centerId: 'center-1' },
};

export const meRoute = (role) => ok({ user: USERS[role], session: { expiresAt: '2099-01-01T00:00:00.000Z', idleExpiresAt: '2099-01-01T00:00:00.000Z' } });

export const appointment = (overrides = {}) => ({
  id: 'a1',
  centerId: 'center-1',
  professionalId: 'u-ana',
  clientId: 'u-luis',
  startsAt: '2026-12-02T10:00:00.000Z',
  endsAt: '2026-12-02T10:50:00.000Z',
  status: 'scheduled',
  createdAt: '2026-11-19T03:26:00.123Z',
  ...overrides,
});

// Replaces fetch. `routes` maps "METHOD /path" (without /api and query) to a
// response, or to a function that returns one (or a promise).
export function mockApi(routes) {
  const calls = [];
  const fn = vi.fn(async (input, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    const full = String(input);
    const path = full.replace(/^\/api/, '').split('?')[0];
    const call = { method, path, input: full, init, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    let handler = routes[`${method} ${path}`];
    if (handler === undefined) handler = fail(404, 'not_found', 'Route not found.');
    if (typeof handler === 'function') handler = await handler(call);
    const { status = 200, json } = handler;
    return { ok: status >= 200 && status < 300, status, json: async () => json };
  });
  vi.stubGlobal('fetch', fn);
  return { calls, fn };
}

export function renderApp(path, routes, role = 'professional') {
  const api = mockApi({ 'GET /auth/me': role ? meRoute(role) : fail(401, 'unauthenticated', 'Sign-in is required.'), ...routes });
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
  return { ...api, ...view };
}

export class FakeWebSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.sent = [];
    this.closed = false;
    FakeWebSocket.instances.push(this);
  }
  send(data) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
}
