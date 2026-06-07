import { BadRequestException, Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../tenant/api-key.guard';
import { BillingService } from './billing.service';
import { PLANS } from './plans';

interface ChangePlanBody { plan_id?: unknown }

@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  // Public catalog of available plans.
  @Get('plans')
  plans() {
    return Object.values(PLANS);
  }

  @Get('plan')
  @UseGuards(ApiKeyGuard)
  async current(@Req() req: any) {
    return this.billing.getCurrentInvoice(req.tenant.id);
  }

  @Put('plan')
  @UseGuards(ApiKeyGuard)
  async change(@Req() req: any, @Body() body: ChangePlanBody) {
    if (typeof body.plan_id !== 'string' || !body.plan_id) {
      throw new BadRequestException('plan_id is required');
    }
    await this.billing.changePlan(req.tenant.id, body.plan_id);
    return this.billing.getCurrentInvoice(req.tenant.id);
  }

  @Get('invoice')
  @UseGuards(ApiKeyGuard)
  async invoice(@Req() req: any) {
    return this.billing.getCurrentInvoice(req.tenant.id);
  }
}
