export interface Session {
  send(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<unknown>;
  /** Subscribe to a CDP event; returns the unsubscribe. */
  on(method: string, fn: (params: Record<string, unknown>) => void): () => void;
  close(): void;
}

/** One persistent socket: tracing streams its events on the session that started it. */
export function openSession(url: string): Promise<Session> {
  const ws = new WebSocket(url);
  let nextId = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const listeners = new Map<string, Set<(p: Record<string, unknown>) => void>>();
  ws.addEventListener("close", () => {
    for (const call of pending.values()) call.reject(new Error("Chrome disconnected"));
    pending.clear();
  });

  ws.addEventListener("message", (evt) => {
    const msg = JSON.parse(String(evt.data)) as {
      id?: number;
      result?: unknown;
      error?: unknown;
      method?: string;
      params?: Record<string, unknown>;
    };
    if (msg.id !== undefined) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p?.reject(new Error(JSON.stringify(msg.error)));
      else p?.resolve(msg.result);
    } else if (msg.method) {
      for (const fn of listeners.get(msg.method) ?? []) fn(msg.params ?? {});
    }
  });

  const session: Session = {
    send(method, params = {}, timeoutMs = 10_000) {
      if (ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error("Chrome disconnected"));
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method} timeout`));
        }, timeoutMs);
        pending.set(id, {
          resolve: (v) => (clearTimeout(timer), resolve(v)),
          reject: (e) => (clearTimeout(timer), reject(e)),
        });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    on(method, fn) {
      const set = listeners.get(method) ?? new Set();
      listeners.set(method, set);
      set.add(fn);
      return () => set.delete(fn);
    },
    close: () => ws.close(),
  };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error("Chrome connection timed out")); ws.close(); }, 10_000);
    ws.addEventListener("open", () => { clearTimeout(timer); resolve(session); });
    ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Chrome WebSocket connection failed")); });
  });
}
