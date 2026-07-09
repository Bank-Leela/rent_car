// Pure queue-sort helper — shared by the server queue page (which parses the
// URL param) and the client QueueFilterBar. Kept OUT of the "use client" file
// so the server can call it (Next forbids invoking a client-module function
// from a Server Component).

const SORTS = ["start", "oldest", "risk"] as const;
export type QueueSort = (typeof SORTS)[number];

export function parseQueueSort(v: string | undefined): QueueSort {
  return (SORTS as readonly string[]).includes(v ?? "") ? (v as QueueSort) : "start";
}
