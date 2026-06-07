import { VerificationRecordService } from './verification-record.service';

test('saves a record scoped to the tenant (RLS) on the provided manager', async () => {
  const saved: any[] = [];
  const manager = { save: jest.fn(async (_e: any, row: any) => { saved.push(row); return row; }) };
  const svc = new VerificationRecordService();
  await svc.saveWith(manager as any, { id: 'tx1', tenantId: 'ten1', status: 'aprovado' } as any);
  expect(saved[0].id).toBe('tx1');
  expect(manager.save).toHaveBeenCalledTimes(1);
});
