import { openSync, closeSync, writeSync, renameSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Session } from "./session.ts";

export async function snapshot(session: Session, path: string) {
  await session.send("HeapProfiler.enable");
  const temp = path + "." + randomUUID() + ".tmp";
  const fd = openSync(temp, "wx");
  let failure: unknown;
  let count = 0;
  const off = session.on("HeapProfiler.addHeapSnapshotChunk", ({ chunk }) => {
    if (failure) return;
    try {
      writeSync(fd, String(chunk));
      count++;
    } catch (error) {
      failure = error;
    }
  });
  try {
    try {
      await session.send("HeapProfiler.takeHeapSnapshot", {}, 120000);
      if (failure) throw failure;
      if (!count) throw new Error("Chrome sent an empty heap snapshot");
    } finally {
      off();
      closeSync(fd);
    }
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
}

async function totals(path: string) {
  const raw = JSON.parse(await readFile(path, "utf8"));
  const meta = raw.snapshot?.meta;
  const fields: string[] = meta?.node_fields ?? [];
  const type = fields.indexOf("type"),
    name = fields.indexOf("name"),
    size = fields.indexOf("self_size");
  const nodes = raw.nodes;
  const types = meta?.node_types?.[type];
  if (
    [type, name, size].includes(-1) ||
    !Array.isArray(nodes) ||
    nodes.length % fields.length ||
    !Array.isArray(types) ||
    !Array.isArray(raw.strings)
  )
    throw new Error("Invalid V8 heap snapshot: " + path);
  const result = new Map<string, { count: number; bytes: number }>();
  for (let i = 0; i < nodes.length; i += fields.length) {
    const kind = types[nodes[i + type]];
    const bytes = nodes[i + size];
    if (typeof kind !== "string" || !Number.isSafeInteger(bytes) || bytes < 0)
      throw new Error("Invalid V8 heap node");
    const label =
      kind === "object" || kind === "native"
        ? kind + "/" + raw.strings[nodes[i + name]]
        : kind;
    const group = result.get(label) ?? { count: 0, bytes: 0 };
    group.count++;
    group.bytes += bytes;
    result.set(label, group);
  }
  return result;
}
export async function compareHeaps(before: string, after: string) {
  const a = await totals(before);
  const b = await totals(after);
  return Array.from(new Set([...a.keys(), ...b.keys()]), (type) => ({
    type,
    countDelta: (b.get(type)?.count ?? 0) - (a.get(type)?.count ?? 0),
    shallowBytesDelta: (b.get(type)?.bytes ?? 0) - (a.get(type)?.bytes ?? 0),
  }))
    .filter((row) => row.countDelta || row.shallowBytesDelta)
    .sort(
      (x, y) =>
        y.shallowBytesDelta - x.shallowBytesDelta ||
        y.countDelta - x.countDelta ||
        x.type.localeCompare(y.type),
    );
}
