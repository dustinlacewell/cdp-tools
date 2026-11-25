export const help = `Usage: trace-query <trace.json> <command> [options]

Global options:
  --origin <pattern>                Filter to events from URLs matching pattern.
                                    Use with event and CPU profile queries to focus on your
                                    code and exclude browser internals.
                                    Example: --origin "openfront|extension"

  --within <pattern>                Restrict analysis to time ranges where a
                                    matching parent event is active.
                                    Example: --within HandlePostMessage

Commands:
  overview                          Trace summary: duration, threads, event counts
  threads                           List all threads with event counts
  categories                        List all event categories with counts
  names [--cat <cat>] [--thread <name>] [--limit N]
                                    List unique event names with occurrence counts
  top [--n N] [--thread <name>] [--cat <cat>]
                                    Top N events by total duration
  summarize <name>                  Stats for a specific event name
  search <pattern> [--limit N] [--thread <name>]
                                    Search events by name (regex)
  slowest <pattern> [--limit N]     Longest individual occurrences of an event
  frames                            Animation frame timing statistics
  frame <index|"worst">             Break down a single frame's events
  long-tasks [--threshold N]        Main-thread tasks exceeding threshold (ms)
  gc                                Garbage collection summary
  counters [--name <pattern>]       Counter (C) event values over time
  slices <pattern> [--limit N]      Show async slices (b/e pairs) matching pattern
  tree <pattern> [--limit N]        Show call tree for events matching pattern
  sources                           List all JS source URLs from the trace
  scripts                           List known scriptId → URL mappings
  calls [--source <url>] [--limit N]
                                    Function calls, optionally filtered by source URL
  functions [--sort total|mean|max|count] [--limit N]
                                    All functions called, with call count and durations
  profile [--limit N]               CPU profile: sampled self-time by function
  profile-heavy [--limit N]         CPU profile: self+total time (bottom-up)
  group <pattern> [--budget N] [--depth N] [--limit N]
                                    Analyze recurring event: distribution, children, budget
  diff <trace2.json> <subcommand> [options]
                                    Compare two traces (supports: profile, top, group, health, frames, gc, long-tasks)

Game performance:
  inventory                         Identify evidence present in this trace
  pacing                            Presentation gaps and dropped frames by stream
  diagnose [frame-id]               Inspect the worst gap or a selected frame
  metrics [pattern]                 Game marks, measures, custom tracks and GPU timers
  events [pattern]                    Query complete intervals with source timestamps
  self [pattern]                    Rank exclusive thread time
  check <pattern> --budget MS       Enforce p95 duration (exit 2 for a breach)

Options:
  --format text|json                Versioned report envelope
  --pid ID --tid ID                 Select process and thread
  --from MS --to MS                 Event start window from trace origin, end exclusive
  --hz HZ                           Set target display rate
  --map-url URL --source-map FILE   Map sampled JS locations with a local v3 source map
  --limit N                         Bound report rows
  --help | --version
Use - for stdin. Plain JSON and gzip are detected by content.
`;
