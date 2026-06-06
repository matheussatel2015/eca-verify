import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID, randomBytes } from 'crypto';
import { Tenant } from './tenant.entity';
import { ApiKeyService } from './api-key.service';
import { encryptSecret } from './secret-crypto';
import { encryptionKey } from '../config';

export const SECRET_KEY = Symbol('SECRET_KEY');

export interface RegisterInput {
  name: string;
  webhookUrl: string;
}

@Injectable()
export class TenantService {
  constructor(
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    private readonly apiKeys: ApiKeyService,
    @Inject(SECRET_KEY) private readonly key: Buffer = encryptionKey(process.env),
  ) {}

  async register(input: RegisterInput): Promise<{ tenant_id: string; api_key: string; webhook_secret: string }> {
    const rawSecret = 'whsec_' + randomBytes(24).toString('hex');
    const tenant: Tenant = {
      id: randomUUID(),
      name: input.name,
      webhookUrl: input.webhookUrl,
      webhookSecret: encryptSecret(rawSecret, this.key),
    };
    await this.tenants.save(tenant);
    const issued = await this.apiKeys.issue(tenant.id, 'default');
    return { tenant_id: tenant.id, api_key: issued.key, webhook_secret: rawSecret };
  }
}
