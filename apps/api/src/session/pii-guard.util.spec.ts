import { assertNoPii } from './pii-guard.util';

test('passes a clean payload', () => {
  expect(() => assertNoPii({ user_hash: 'abc123' })).not.toThrow();
});

test('rejects a payload containing cpf', () => {
  expect(() => assertNoPii({ user_hash: 'abc', cpf: '00000000000' })).toThrow(/pii/i);
});

test('rejects a payload containing nome', () => {
  expect(() => assertNoPii({ user_hash: 'abc', nome: 'Maria' })).toThrow(/pii/i);
});
