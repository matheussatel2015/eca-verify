import { BadRequestException, Body, Controller, Delete, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { TenantService } from './tenant.service';
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
}
