import { BadRequestException, Body, Controller, Get, HttpCode, Post, Put, Req, UseGuards } from '@nestjs/common';
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

  // Start a hosted Stripe Checkout for a paid plan.
  @Post('checkout')
  @UseGuards(ApiKeyGuard)
  async checkout(@Req() req: any, @Body() body: { plan_id?: unknown }) {
    if (typeof body.plan_id !== 'string' || !body.plan_id) throw new BadRequestException('plan_id is required');
    return this.billing.startCheckout(req.tenant.id, body.plan_id);
  }

  // Stripe webhook: public, raw-body + signature-verified inside the provider.
  @Post('stripe/webhook')
  @HttpCode(202)
  async stripeWebhook(@Req() req: any) {
    const signature = req.headers['stripe-signature'] ?? '';
    const raw: Buffer | undefined = req.rawBody;
    if (!raw) throw new BadRequestException('rawBody unavailable (NestFactory rawBody:true required)');
    const change = await this.billing.resolveAndApplyWebhook(raw, signature);
    return { received: true, applied: !!change };
  }
}
