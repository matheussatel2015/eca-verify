import { TenantSettingsService } from './tenant-settings.service';

function fakeDataSourceWith(tenant: any) {
  const manager = {
    findOneOrFail: jest.fn(async () => tenant),
    update: jest.fn(async (_e: any, _id: any, patch: any) => { Object.assign(tenant, patch); return { affected: 1 }; }),
  };
  // runScoped uses createQueryRunner(); fake just enough surface.
  const dataSource: any = {
    createQueryRunner: () => ({
      connect: jest.fn(),
      query: jest.fn(),
      release: jest.fn(),
      manager,
    }),
  };
  return { dataSource, manager };
}

test('reads the tenant required_age scoped to the tenant', async () => {
  const { dataSource, manager } = fakeDataSourceWith({ id: 't1', requiredAge: 18 });
  const svc = new TenantSettingsService(dataSource);
  const out = await svc.getRequiredAge('t1');
  expect(out).toBe(18);
  expect(manager.findOneOrFail).toHaveBeenCalled();
});

test('updates required_age within the valid range', async () => {
  const t = { id: 't1', requiredAge: 18 };
  const { dataSource, manager } = fakeDataSourceWith(t);
  const svc = new TenantSettingsService(dataSource);
  const out = await svc.setRequiredAge('t1', 21);
  expect(out).toBe(21);
  expect(manager.update).toHaveBeenCalledWith(expect.anything(), 't1', { requiredAge: 21 });
});

test('rejects an out-of-range required_age', async () => {
  const { dataSource } = fakeDataSourceWith({ id: 't1', requiredAge: 18 });
  const svc = new TenantSettingsService(dataSource);
  await expect(svc.setRequiredAge('t1', 0)).rejects.toThrow(/required_age/);
  await expect(svc.setRequiredAge('t1', 130)).rejects.toThrow(/required_age/);
});
