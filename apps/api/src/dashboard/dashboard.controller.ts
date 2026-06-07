import { Controller, Get, Header, Query, Req, UseGuards } from '@nestjs/common';
import { DashboardAuthGuard } from '../auth/dashboard-auth.guard';
import { DashboardService } from './dashboard.service';
import { parsePagination } from './pagination';
import { DASHBOARD_HTML } from './dashboard.page';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  // Public HTML shell; the data endpoints below require the API key.
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'")
  page(): string {
    return DASHBOARD_HTML;
  }

  @Get('stats')
  @UseGuards(DashboardAuthGuard)
  async stats(@Req() req: any, @Query('from') from?: string, @Query('to') to?: string) {
    const toDate = to ? new Date(to) : new Date();
    const fromDate = from ? new Date(from) : new Date(toDate.getTime() - THIRTY_DAYS_MS);
    const summary = await this.service.getStats(req.tenant.id, fromDate, toDate);
    return { from: fromDate.toISOString(), to: toDate.toISOString(), ...summary };
  }

  @Get('audit')
  @UseGuards(DashboardAuthGuard)
  async audit(@Req() req: any, @Query() q: Record<string, unknown>) {
    const status = typeof q.status === 'string' && q.status ? q.status : undefined;
    return this.service.getAudit(req.tenant.id, parsePagination(q), status);
  }
}
