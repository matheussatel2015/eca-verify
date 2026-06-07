export interface Pagination { limit: number; offset: number }

export function parsePagination(q: { limit?: unknown; offset?: unknown }): Pagination {
  const rawLimit = Number(q.limit ?? 20);
  const rawOffset = Number(q.offset ?? 0);
  const limit = Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, Math.floor(rawLimit))) : 20;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.floor(rawOffset)) : 0;
  return { limit, offset };
}
