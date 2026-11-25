/** Chrome Trace Event (Trace Event Format spec) */
export interface TraceEvent {
  name?: string;
  cat?: string;
  ph: string;
  pid: number;
  tid: number;
  ts: number;
  dur?: number;
  tdur?: number;
  args?: Record<string, unknown>;
  id?: string;
  id2?: { local?: string; global?: string };
  s?: string;
}

export interface TraceFile {
  metadata?: Record<string, unknown>;
  traceEvents: TraceEvent[];
}

export interface ThreadInfo {
  pid: number;
  tid: number;
  processName: string;
  threadName: string;
  eventCount: number;
}

/** A call frame from the CPU profiler */
export interface CallFrame {
  functionName: string;
  scriptId: number;
  url: string;
  lineNumber: number;
  columnNumber: number;
  codeType?: string;
}

/** A node in the CPU profile tree */
export interface ProfileNode {
  id: number;
  callFrame: CallFrame;
  parent?: number;
  children?: number[];
}

/** A sample belongs to one CPU profile; node IDs restart in each profile. */
export interface ProfileSample {
  profileKey: string;
  nodeId: number;
  ts: number;
  durationUs: number;
  pid: number;
  tid: number;
}

/** A time range in microseconds */
export interface TimeRange {
  start: number;
  end: number;
}
