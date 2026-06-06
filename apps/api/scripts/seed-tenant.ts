import 'reflect-metadata';
import { randomUUID, createHash, randomBytes } from 'crypto';
import { AppDataSource } from '../src/db/data-source';
import { Tenant } from '../src/tenant/tenant.entity';

async function main() {
  await AppDataSource.initialize();
  const apiKey = 'sk_' + randomBytes(24).toString('hex');
  const tenant: Tenant = {
    id: randomUUID(),
    name: 'Demo Tenant',
    apiKeyHash: createHash('sha256').update(apiKey).digest('hex'),
    webhookUrl: process.env.SEED_WEBHOOK_URL ?? 'http://localhost:4000/webhook',
    webhookSecret: randomBytes(16).toString('hex'),
  };
  await AppDataSource.getRepository(Tenant).save(tenant);
  console.log('Tenant id:', tenant.id);
  console.log('API key (store now, not recoverable):', apiKey);
  await AppDataSource.destroy();
}
main();
