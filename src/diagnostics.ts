import { open, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import type { Session } from "./session.ts";
import { frameStats } from "./frame-cost.ts";

export const saveJson = (path: string, value: unknown) =>
  writeFile(path, JSON.stringify(value, null, 2) + "\n");

export async function observe(session: Session) {
  const events: { time: string; kind: string; detail: unknown }[] = [];
  const requests = new Map<string, string>();
  let dropped = 0;
  function log(kind: string, detail: unknown) {
    if (events.length < 2000)
      events.push({ time: new Date().toISOString(), kind, detail });
    else dropped++;
  }
  session.on("Network.requestWillBeSent", (e) => {
    requests.set(String(e.requestId), (e.request as { url: string }).url);
  });
  session.on("Network.responseReceived", (e) => {
    const { status, url } = e.response as { status: number; url: string };
    if (status >= 400) log("httpError", { status, url });
  });
  session.on("Network.loadingFinished", (e) =>
    requests.delete(String(e.requestId)),
  );
  session.on("Network.loadingFailed", (e) => {
    const id = String(e.requestId);
    log("requestFailed", {
      url: requests.get(id),
      reason: e.errorText,
      canceled: e.canceled,
    });
    requests.delete(id);
  });
  session.on("Runtime.exceptionThrown", (e) => {
    const d = e.exceptionDetails as {
      text: string;
      exception?: { description?: string };
      url?: string;
    };
    log("exception", { text: d.exception?.description ?? d.text, url: d.url });
  });
  session.on("Runtime.consoleAPICalled", (e) => {
    if (e.type !== "error" && e.type !== "warning") return;
    const args = e.args as {
      value?: unknown;
      description?: string;
      type: string;
    }[];
    log("console", {
      level: e.type,
      args: args.map((a) => a.value ?? a.description ?? a.type),
    });
  });
  await session.send("Network.enable");
  await session.send("Runtime.enable");
  return () => ({ events, dropped });
}

export async function accessibility(session: Session) {
  await session.send("Accessibility.enable");
  const { nodes } = (await session.send("Accessibility.getFullAXTree")) as {
    nodes: {
      nodeId: string;
      parentId?: string;
      ignored: boolean;
      name?: { value: string };
      role?: { value: string };
      properties?: { name: string; value: { value?: unknown } }[];
    }[];
  };
  const tree = nodes.map((n) => ({
    id: n.nodeId,
    parent: n.parentId,
    ignored: n.ignored,
    role: n.role?.value,
    name: n.name?.value,
    states: Object.fromEntries(
      (n.properties ?? []).map((p) => [p.name, p.value.value]),
    ),
  }));
  const controls = new Set([
    "button",
    "checkbox",
    "combobox",
    "link",
    "radio",
    "slider",
    "switch",
    "textbox",
  ]);
  return {
    nodes: tree,
    unnamedControls: tree
      .filter(
        (n) => !n.ignored && controls.has(n.role ?? "") && !n.name?.trim(),
      )
      .map((n) => n.id),
  };
}

async function evaluate<T>(session: Session, expression: string) {
  const r = (await session.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
  })) as {
    exceptionDetails?: unknown;
    result: { value: T };
  };
  if (r.exceptionDetails)
    throw new Error("Frame measurement lost its page execution context");
  return r.result.value;
}

async function taskTime(session: Session) {
  const { metrics } = (await session.send("Performance.getMetrics")) as {
    metrics: { name: string; value: number }[];
  };
  const metric = metrics.find((m) => m.name === "TaskDuration");
  if (!metric) throw new Error("Chrome did not supply TaskDuration");
  return metric.value;
}

async function measure(
  session: Session,
  action: () => Promise<void>,
  sampleMs: number,
) {
  const key = JSON.stringify("cdpFrames_" + randomUUID());
  await evaluate(
    session,
    `(() => {
    const s = window[${key}] = {times: [], id: 0};
    const frame = t => {s.times.push(t); s.id=requestAnimationFrame(frame)};
    s.id=requestAnimationFrame(frame);
  })()`,
  );
  const start = performance.now();
  const before = await taskTime(session);
  try {
    await action();
    await sleep(sampleMs);
    const seconds = (await taskTime(session)) - before;
    const times = await evaluate<number[]>(session, `window[${key}].times`);
    const durationMs = performance.now() - start;
    return {
      ...frameStats(times),
      durationMs,
      mainThreadTaskMs: seconds * 1000,
      mainThreadTaskPct: (seconds * 100000) / durationMs,
    };
  } finally {
    await evaluate(
      session,
      `(() => { const s=window[${key}]; if(s){cancelAnimationFrame(s.id); delete window[${key}]} })()`,
    ).catch(() => {});
  }
}

async function finishTrace(session: Session, path: string) {
  let timer: NodeJS.Timeout | undefined;
  let off = () => {};
  const completed = new Promise<string>((resolve, reject) => {
    off = session.on("Tracing.tracingComplete", (e) => {
      if (e.dataLossOccurred || !e.stream) reject(new Error("Chrome returned an incomplete trace"));
      else resolve(String(e.stream));
    });
    timer = setTimeout(
      () => reject(new Error("Chrome trace completion timed out")),
      30000,
    );
  });
  try {
    const [, handle] = await Promise.all([
      session.send("Tracing.end"),
      completed,
    ]);
    const file = await open(path, "wx");
    try {
      let eof = false;
      while (!eof) {
        const part = (await session.send("IO.read", { handle })) as {
          data: string;
          base64Encoded?: boolean;
          eof: boolean;
        };
        await file.writeFile(
          Buffer.from(part.data, part.base64Encoded ? "base64" : "utf8"),
        );
        eof = part.eof;
      }
    } finally {
      await file.close();
      await session.send("IO.close", { handle });
    }
  } finally {
    off();
    clearTimeout(timer);
  }
}

export async function benchmark(
  session: Session,
  dir: string,
  action: () => Promise<void>,
  sampleMs: number,
  preset: "standard" | "game" = "standard",
) {
  await session.send("Performance.enable");
  await session.send("Tracing.start", {
    categories: preset === "game"
      ? "-*,toplevel,blink.user_timing,devtools.timeline,v8,disabled-by-default-v8.cpu_profiler,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame,cc,viz,benchmark,gpu"
      : "devtools.timeline,blink.user_timing",
    transferMode: "ReturnAsStream",
    streamFormat: "json",
  });
  try {
    const baseline = await measure(session, async () => {}, sampleMs);
    const interaction = await measure(session, action, sampleMs);
    return {
      baseline,
      interaction,
      p95DeltaMs: interaction.p95Ms - baseline.p95Ms,
      mainThreadTaskPctDelta:
        interaction.mainThreadTaskPct - baseline.mainThreadTaskPct,
    };
  } finally {
    await finishTrace(session, join(dir, "trace.json"));
  }
}
