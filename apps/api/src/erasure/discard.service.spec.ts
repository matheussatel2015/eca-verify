import { DiscardService } from './discard.service';

test('records a discard event scoped to the tenant', async () => {
  const saved: any[] = [];
  const manager = { save: jest.fn(async (_e: any, row: any) => { saved.push(row); return row; }) };
  const dataSource: any = {
    createQueryRunner: () => ({ connect: jest.fn(), query: jest.fn(), release: jest.fn(), manager }),
  };
  const svc = new DiscardService(dataSource);
  await svc.record({ transactionId: 'tx1', tenantId: 'ten1', what: 'frame', now: new Date('2026-06-07T00:00:00Z') });
  expect(saved[0]).toMatchObject({ transactionId: 'tx1', tenantId: 'ten1', what: 'frame' });
  expect(manager.save).toHaveBeenCalledTimes(1);
});

test('never throws into the caller (best-effort erasure proof)', async () => {
  const dataSource: any = { createQueryRunner: () => { throw new Error('db down'); } };
  const svc = new DiscardService(dataSource);
  await expect(svc.record({ transactionId: 'tx2', tenantId: 'ten1', what: 'document', now: new Date() })).resolves.toBeUndefined();
});
