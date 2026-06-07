import { classifyAgeBand, AGE_BAND_THRESHOLDS } from './age-band';

test('classifies a young child as crianca (<12)', () => {
  expect(classifyAgeBand(8)).toBe('crianca');
  expect(classifyAgeBand(11)).toBe('crianca');
});

test('classifies 12-15 as adolescente_jovem', () => {
  expect(classifyAgeBand(12)).toBe('adolescente_jovem');
  expect(classifyAgeBand(15)).toBe('adolescente_jovem');
});

test('classifies 16-17 as adolescente', () => {
  expect(classifyAgeBand(16)).toBe('adolescente');
  expect(classifyAgeBand(17)).toBe('adolescente');
});

test('classifies 18+ as adulto', () => {
  expect(classifyAgeBand(18)).toBe('adulto');
  expect(classifyAgeBand(40)).toBe('adulto');
});

test('returns null for unknown age', () => {
  expect(classifyAgeBand(null)).toBeNull();
});

test('thresholds are named constants (confirmar com jurídico)', () => {
  expect(AGE_BAND_THRESHOLDS).toEqual({ crianca: 12, adolescenteJovem: 16, adulto: 18 });
});
