import { shapeStats } from './dashboard-stats';

test('aggregates rows into total + per-status counts with zero-filled defaults', () => {
  const s = shapeStats([{ status: 'aprovado', count: 5 }, { status: 'reprovado', count: 2 }]);
  expect(s.total).toBe(7);
  expect(s.byStatus).toEqual({ aprovado: 5, reprovado: 2, documento_requerido: 0 });
});

test('returns all-zero summary for no rows', () => {
  expect(shapeStats([])).toEqual({ total: 0, byStatus: { aprovado: 0, reprovado: 0, documento_requerido: 0 } });
});

test('counts an unexpected status without crashing', () => {
  const s = shapeStats([{ status: 'processando', count: 3 }]);
  expect(s.total).toBe(3);
  expect(s.byStatus.processando).toBe(3);
});
