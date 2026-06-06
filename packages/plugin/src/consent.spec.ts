import { canActivateCamera } from './consent';

test('camera is blocked until consent is given', () => {
  expect(canActivateCamera({ consentGiven: false })).toBe(false);
});

test('camera is allowed once consent is given', () => {
  expect(canActivateCamera({ consentGiven: true })).toBe(true);
});
