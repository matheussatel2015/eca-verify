import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VerificationStatus } from '@eca/sdk-types';
import { AuditLog } from './audit-log.entity';
import { maskIp } from './ip-mask.util';

interface BuildArgs {
  transactionId: string;
  tenantId: string;
  rawIp: string;
  status: VerificationStatus;
  now: Date;
}

@Injectable()
export class AuditService {
  constructor(@InjectRepository(AuditLog) private readonly logs: Repository<AuditLog>) {}

  static buildRecord(args: BuildArgs): AuditLog {
    return {
      id: args.transactionId,
      tenantId: args.tenantId,
      maskedIp: maskIp(args.rawIp),
      status: args.status,
      createdAt: args.now,
    };
  }

  async record(args: BuildArgs): Promise<void> {
    await this.logs.save(AuditService.buildRecord(args));
  }
}
