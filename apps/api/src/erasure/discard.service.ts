import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DiscardEvent } from './discard-event.entity';
import { buildDiscardEvent, DiscardEventInput } from './discard-event.builder';
import { runScoped } from '../tenant/tenant-scope';

@Injectable()
export class DiscardService {
  private readonly logger = new Logger(DiscardService.name);
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Best-effort proof that the ephemeral media was deleted. Runs in the processor's
   * `finally`; it must NEVER throw, because the physical delete already happened and
   * a logging failure must not mask the success or re-trigger work.
   */
  async record(input: DiscardEventInput): Promise<void> {
    try {
      const event = buildDiscardEvent(input);
      await runScoped(this.dataSource, input.tenantId, (mgr) => mgr.save(DiscardEvent, event));
    } catch (e) {
      this.logger.warn(`failed to write discard proof for ${input.transactionId}: ${(e as Error).message}`);
    }
  }
}
