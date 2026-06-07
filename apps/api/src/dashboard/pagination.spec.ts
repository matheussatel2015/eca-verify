import { parsePagination } from './pagination';

test('defaults to limit 20 offset 0', () => {
  expect(parsePagination({})).toEqual({ limit: 20, offset: 0 });
});

test('clamps limit to 1..100 and offset to >= 0', () => {
  expect(parsePagination({ limit: '500', offset: '-3' })).toEqual({ limit: 100, offset: 0 });
  expect(parsePagination({ limit: '0' })).toEqual({ limit: 1, offset: 0 });
});

test('falls back to defaults on non-numeric input', () => {
  expect(parsePagination({ limit: 'abc', offset: 'xyz' })).toEqual({ limit: 20, offset: 0 });
});
