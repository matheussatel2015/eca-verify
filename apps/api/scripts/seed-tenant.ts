import 'reflect-metadata';
import { randomUUID, randomBytes } from 'crypto';
import { AppDataSource } from '../src/db/data-source';
import { Tenant } from '../src/tenant/tenant.entity';
import { ApiKeyService } from '../src/tenant/api-key.service';
import { encryptSecret } from '../src/tenant/secret-crypto';
import { encryptionKey } from '../src/config';

async function main() {
  await AppDataSource.initialize();
  const key = encryptionKey(process.env);
  const rawSecret = 'whsec_' + randomBytes(24).toString('hex');
  const tenant: Tenant = {
    id: randomUUID(),
    name: 'Demo Tenant',
    webhookUrl: process.env.SEED_WEBHOOK_URL ?? 'http://localhost:4000/webhook',
    webhookSecret: encryptSecret(rawSecret, key),
  };
  await AppDataSource.getRepository(Tenant).save(tenant);

  const svc = new ApiKeyService(
    AppDataSource.getRepository((await import('../src/tenant/api-key.entity')).ApiKey),
    AppDataSource.getRepository(Tenant),
  );
  const issued = await svc.issue(tenant.id, 'seed');

  console.log('Tenant id:', tenant.id);
  console.log('API key (store now, not recoverable):', issued.key);
  console.log('Webhook secret (raw):', rawSecret);
  await AppDataSource.destroy();
}
main();
