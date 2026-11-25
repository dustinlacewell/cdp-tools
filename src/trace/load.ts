import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { JSONParser } from "@streamparser/json";
import { TraceStore } from "./trace-store.ts";
import type { TraceEvent, TraceFile } from "./types.ts";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function traceFile(value: unknown): TraceFile {
  const events = Array.isArray(value)
    ? value
    : record(value)
      ? value.traceEvents
      : undefined;
  if (!Array.isArray(events))
    throw new Error(
      "Expected an event array or an object with a traceEvents array.",
    );
  for (const [index, event] of events.entries()) {
    if (
      !record(event) ||
      typeof event.ph !== "string" ||
      !Number.isFinite(event.ts) ||
      !Number.isInteger(event.pid) ||
      !Number.isInteger(event.tid) ||
      (event.dur !== undefined &&
        (!Number.isFinite(event.dur) || Number(event.dur) < 0)) ||
      (event.name !== undefined && typeof event.name !== "string")
    ) {
      throw new Error(
        `Invalid trace event at index ${index}. Check ph, ts, pid, tid, name and dur.`,
      );
    }
  }
  return {
    traceEvents: events as TraceEvent[],
    metadata: record(value) && record(value.metadata) ? value.metadata : {},
  };
}

/** Decode incrementally while retaining the event index required by cross-thread queries. */
export async function loadTrace(path: string): Promise<TraceStore> {
  const source = path === "-" ? process.stdin : createReadStream(path);
  const iterator = source[Symbol.asyncIterator]();
  try {
    const prefix: Buffer[] = [];
    let size = 0;
    while (size < 2) {
      const next = await iterator.next();
      if (next.done) break;
      const chunk = Buffer.from(next.value);
      prefix.push(chunk);
      size += chunk.length;
    }
    const first = Buffer.concat(prefix);
    const stream = Readable.from(
      (async function* () {
        yield first;
        for (;;) {
          const next = await iterator.next();
          if (next.done) break;
          yield next.value;
        }
      })(),
    );
    let parsed: unknown;
    const parser = new JSONParser({ paths: ["$"], stringBufferSize: 65536 });
    parser.onValue = ({ value }) => {
      parsed = value;
    };
    async function consume(chunks: AsyncIterable<Buffer>) {
      for await (const chunk of chunks) parser.write(chunk);
      if (!parser.isEnded) parser.end();
    }
    if (first[0] === 31 && first[1] === 139)
      await pipeline(stream, createGunzip(), consume);
    else await consume(stream);
    return new TraceStore(traceFile(parsed));
  } finally {
    await iterator.return?.();
  }
}
