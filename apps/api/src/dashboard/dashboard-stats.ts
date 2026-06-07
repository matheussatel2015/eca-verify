export interface StatsRow { status: string; count: number }
export interface StatsSummary { total: number; byStatus: Record<string, number> }

export function shapeStats(rows: StatsRow[]): StatsSummary {
  const byStatus: Record<string, number> = { aprovado: 0, reprovado: 0, documento_requerido: 0 };
  let total = 0;
  for (const r of rows) {
    const c = Number(r.count) || 0;
    byStatus[r.status] = (byStatus[r.status] ?? 0) + c;
    total += c;
  }
  return { total, byStatus };
}
