import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { randomUUID, randomBytes, createHash } from 'crypto';
import { ApiKey } from './api-key.entity';
import { Tenant } from './tenant.entity';

export interface GeneratedKey {
  key: string;
  hash: string;
}

@Injectable()
export class ApiKeyService {
  constructor(
    @InjectRepository(ApiKey) private readonly keys: Repository<ApiKey>,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
  ) {}

  static generate(): GeneratedKey {
    const key = 'sk_' + randomBytes(24).toString('hex');
    const hash = createHash('sha256').update(key).digest('hex');
    return { key, hash };
  }

  async issue(tenantId: string, label: string | null = null): Promise<{ id: string; key: string }> {
    const { key, hash } = ApiKeyService.generate();
    const row: ApiKey = {
      id: randomUUID(),
      tenantId,
      keyHash: hash,
      label,
      createdAt: new Date(),
      revokedAt: null,
    };
    await this.keys.save(row);
    return { id: row.id, key };
  }

  async revoke(id: string, tenantId: string): Promise<void> {
    await this.keys.update({ id, tenantId, revokedAt: IsNull() }, { revokedAt: new Date() });
  }

  async resolveTenant(presentedKey: string): Promise<Tenant | null> {
    const hash = createHash('sha256').update(presentedKey).digest('hex');
    const row = await this.keys.findOne({ where: { keyHash: hash, revokedAt: IsNull() } });
    if (!row) return null;
    return this.tenants.findOne({ where: { id: row.tenantId } });
  }
}
