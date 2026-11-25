/** Minimal CDP client using Node's built-in WebSocket. */

const CDP_HOST = process.env["CDP_HOST"] ?? "127.0.0.1";
const CDP_PORT = process.env["CDP_PORT"] ?? "9222";

export const cdpBase = () => `http://${CDP_HOST}:${CDP_PORT}`;

export interface Target {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
}

export async function listTargets(base = cdpBase()): Promise<Target[]> {
  const res = await fetch(`${base}/json/list`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Chrome target discovery returned HTTP ${res.status}`);
  return (await res.json()) as Target[];
}

export async function selectPage(match?: string, base?: string, requireUnique = true) {
  const pages = (await listTargets(base)).filter(target => target.type === "page");
  const exact = pages.find(page => page.id === match);
  if (exact) return exact;
  const matches = match ? pages.filter(p => p.url.includes(match) || p.title.toLowerCase().includes(match.toLowerCase())) : pages;
  if (!matches.length) throw new Error(`No page found${match ? " matching " + match : ""}`);
  if ((match || requireUnique) && matches.length > 1) throw new Error("Multiple pages match. Select a target using --page.");
  return matches[0]!;
}

/** Find the first page target, or by substring match on url/title. */
export async function findPage(match?: string): Promise<Target> {
  const targets = await listTargets();
  const pages = targets.filter((t) => t.type === "page");
  if (pages.length === 0) throw new Error("No page targets found");
  if (!match) return pages[0]!;
  const found = pages.find(
    (p) =>
      p.url.includes(match) || p.title.toLowerCase().includes(match.toLowerCase()),
  );
  return found ?? pages[0]!;
}

type CdpResult = { result?: { value?: string }; exceptionDetails?: unknown };

/** Open a CDP WebSocket and evaluate an expression. Returns the raw string value. */
export async function evaluate(
  target: Target,
  expression: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("CDP evaluate timeout (30s)"));
    }, 30_000);

    ws.addEventListener("open", () => {
      ws.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: {
            expression,
            returnByValue: true,
            awaitPromise: true,
          },
        }),
      );
    });

    ws.addEventListener("message", (evt) => {
      const msg = JSON.parse(String(evt.data)) as { id?: number; result?: CdpResult };
      if (msg.id === 1) {
        clearTimeout(timer);
        ws.close();
        const val = msg.result?.result?.value;
        if (msg.result?.exceptionDetails) {
          reject(new Error(JSON.stringify(msg.result.exceptionDetails)));
        } else {
          resolve(val ?? "undefined");
        }
      }
    });

    ws.addEventListener("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`WebSocket error: ${(e as ErrorEvent).message}`));
    });
  });
}

/** Send a CDP command and get the result. */
export async function send(
  target: Target,
  method: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("CDP send timeout (10s)"));
    }, 10_000);

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ id: 1, method, params }));
    });

    ws.addEventListener("message", (evt) => {
      const msg = JSON.parse(String(evt.data)) as { id?: number; result?: unknown; error?: unknown };
      if (msg.id === 1) {
        clearTimeout(timer);
        ws.close();
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });

    ws.addEventListener("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`WebSocket error: ${(e as ErrorEvent).message}`));
    });
  });
}
