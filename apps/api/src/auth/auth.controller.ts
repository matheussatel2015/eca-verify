import { BadRequestException, Body, Controller, Get, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../tenant/api-key.guard';
import { RateLimitGuard } from '../ratelimit/rate-limit.guard';
import { DashboardAuthGuard } from './dashboard-auth.guard';
import { DashboardAuthService } from './dashboard-auth.service';

interface CreateUserBody { email?: unknown; password?: unknown }
interface LoginBody { email?: unknown; password?: unknown }

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: DashboardAuthService) {}

  // Tenant admin (API key) provisions a dashboard login for their tenant.
  @Post('users')
  @UseGuards(ApiKeyGuard)
  async createUser(@Req() req: any, @Body() body: CreateUserBody) {
    if (typeof body.email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)) {
      throw new BadRequestException('valid email is required');
    }
    if (typeof body.password !== 'string' || body.password.length < 8) {
      throw new BadRequestException('password must be at least 8 characters');
    }
    const u = await this.auth.createUser(req.tenant.id, body.email, body.password);
    return { id: u.id, email: u.email };
  }

  @Post('login')
  @UseGuards(RateLimitGuard)
  async login(@Body() body: LoginBody) {
    if (typeof body.email !== 'string' || typeof body.password !== 'string') {
      throw new BadRequestException('email and password are required');
    }
    const user = await this.auth.login(body.email, body.password);
    if (!user) throw new UnauthorizedException('invalid credentials');
    const token = await this.auth.issueToken(user);
    return { token, token_type: 'Bearer' };
  }

  @Get('me')
  @UseGuards(DashboardAuthGuard)
  me(@Req() req: any) {
    return { tenant_id: req.tenant.id, user: req.dashboardUser ?? null };
  }
}
