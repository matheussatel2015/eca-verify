import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { TenantService } from './tenant.service';
import { TenantSettingsService } from './tenant-settings.service';
import { ApiKeyService } from './api-key.service';
import { ApiKeyGuard } from './api-key.guard';
import { RateLimitGuard } from '../ratelimit/rate-limit.guard';
import { assertSafeWebhookUrl } from '../common/url-safety';

interface RegisterBody {
  name?: unknown;
  webhook_url?: unknown;
}

@Controller('tenants')
export class TenantController {
  constructor(
    private readonly tenants: TenantService,
    private readonly apiKeys: ApiKeyService,
    private readonly settings: TenantSettingsService,
  ) {}

  @Post('register')
  @UseGuards(RateLimitGuard)
  async register(@Body() body: RegisterBody) {
    if (typeof body.name !== 'string' || !body.name.trim()) {
      throw new BadRequestException('name is required');
    }
    if (typeof body.webhook_url !== 'string') {
      throw new BadRequestException('webhook_url must be an http(s) URL');
    }
    try {
      assertSafeWebhookUrl(body.webhook_url);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    return this.tenants.register({ name: body.name.trim(), webhookUrl: body.webhook_url });
  }

  // Rotate = issue a new key (the caller authenticates with an existing key).
  @Post('me/api-keys')
  @UseGuards(ApiKeyGuard)
  async rotate(@Req() req: any) {
    const issued = await this.apiKeys.issue(req.tenant.id, 'rotated');
    return { id: issued.id, api_key: issued.key };
  }

  @Delete('me/api-keys/:id')
  @UseGuards(ApiKeyGuard)
  async revoke(@Req() req: any, @Param('id') id: string) {
    const ok = await this.apiKeys.revoke(id, req.tenant.id);
    if (!ok) throw new NotFoundException('api key not found or already revoked');
    return { revoked: id };
  }

  // Read the caller's own cutoff (and the band thresholds note lives in docs).
  @Get('me/settings')
  @UseGuards(ApiKeyGuard)
  async getSettings(@Req() req: any) {
    const requiredAge = await this.settings.getRequiredAge(req.tenant.id);
    return { required_age: requiredAge };
  }

  // Set the caller's own cutoff. Validation + RLS protect against bad/foreign writes.
  @Put('me/settings')
  @UseGuards(ApiKeyGuard)
  async setSettings(@Req() req: any, @Body() body: { required_age?: unknown }) {
    if (typeof body.required_age !== 'number' || !Number.isInteger(body.required_age)) {
      throw new BadRequestException('required_age must be an integer');
    }
    try {
      const requiredAge = await this.settings.setRequiredAge(req.tenant.id, body.required_age);
      return { required_age: requiredAge };
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }
}
