import { ConsentService } from './consent.service';

test('saveWith persists the consent record on the provided RLS-scoped manager', async () => {
  const saved: any[] = [];
  const manager = { save: jest.fn(async (_e: any, row: any) => { saved.push(row); return row; }) };
  const dataSource: any = {}; // unused on this path
  const svc = new ConsentService(dataSource);
  await svc.saveWith(manager as any, { id: 'c1', tenantId: 'ten1', userHash: 'uh', policyVersion: 'v1', scope: 'age_verification', maskedIp: '1.2.3.0', createdAt: new Date() } as any);
  expect(saved[0].id).toBe('c1');
  expect(manager.save).toHaveBeenCalledTimes(1);
});

test('listByUserHash reads scoped to the tenant', async () => {
  const rows = [{ id: 'c1', userHash: 'uh', policyVersion: 'v1' }];
  const manager = { find: jest.fn(async () => rows) };
  const dataSource: any = {
    createQueryRunner: () => ({ connect: jest.fn(), query: jest.fn(), release: jest.fn(), manager }),
  };
  const svc = new ConsentService(dataSource);
  const out = await svc.listByUserHash('ten1', 'uh');
  expect(out).toEqual(rows);
  expect(manager.find).toHaveBeenCalledWith(expect.anything(), { where: { userHash: 'uh' }, order: { createdAt: 'DESC' } });
});
