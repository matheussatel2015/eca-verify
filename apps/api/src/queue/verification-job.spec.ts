import { buildVerificationJob } from './verification-job';

test('builds a job with all routing fields', () => {
  const job = buildVerificationJob({
    transactionId: 'tx1', tenantId: 'ten1', frameRef: 'tx1', rawIp: '1.2.3.4',
  });
  expect(job).toEqual({ transactionId: 'tx1', tenantId: 'ten1', frameRef: 'tx1', rawIp: '1.2.3.4' });
});
