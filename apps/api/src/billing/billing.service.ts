import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../tenant/tenant.entity';
import { UsageService } from './usage.service';
import { getPlan, isValidPlanId } from './plans';
import { buildInvoice, Invoice } from './invoice';

@Injectable()
export class BillingService {
  constructor(
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    private readonly usage: UsageService,
  ) {}

  async assertWithinQuota(tenantId: string): Promise<void> {
    const tenant = await this.tenants.findOneOrFail({ where: { id: tenantId } });
    const plan = getPlan(tenant.planId);
    const used = await this.usage.current(tenantId);
    if (used >= plan.monthlyQuota) {
      throw new HttpException(
        `monthly quota of ${plan.monthlyQuota} reached for plan '${plan.id}'`,
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
  }

  /**
   * Atomically consume one unit of quota. Replaces the assertWithinQuota +
   * usage.increment two-step (which had a check-then-act race) with a single
   * atomic increment-and-check. Throws 402 when the plan quota is exhausted.
   */
  async consumeQuota(tenantId: string): Promise<void> {
    const tenant = await this.tenants.findOneOrFail({ where: { id: tenantId } });
    const plan = getPlan(tenant.planId);
    const { allowed } = await this.usage.incrementAndCheck(tenantId, plan.monthlyQuota);
    if (!allowed) {
      throw new HttpException(
        `monthly quota of ${plan.monthlyQuota} reached for plan '${plan.id}'`,
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
  }

  async changePlan(tenantId: string, planId: string): Promise<void> {
    if (!isValidPlanId(planId)) {
      throw new HttpException(`unknown plan '${planId}'`, HttpStatus.BAD_REQUEST);
    }
    await this.tenants.update({ id: tenantId }, { planId });
  }

  async getCurrentInvoice(tenantId: string): Promise<Invoice> {
    const tenant = await this.tenants.findOneOrFail({ where: { id: tenantId } });
    const used = await this.usage.current(tenantId);
    return buildInvoice(getPlan(tenant.planId), used, this.currentPeriod());
  }

  private currentPeriod(): string {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
}
