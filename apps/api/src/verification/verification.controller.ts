import { Body, Controller, Post, Req, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { VerificationSession } from '../session/session.entity';
import { Tenant } from '../tenant/tenant.entity';
import { VerificationService } from './verification.service';

interface VerifyBody {
  session_token: string;
  frame: { iv: string; tag: string; ciphertext: string }; // base64
}

@Controller('verify')
export class VerificationController {
  constructor(
    private readonly service: VerificationService,
    @InjectRepository(VerificationSession) private readonly sessions: Repository<VerificationSession>,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
  ) {}

  @Post()
  async verify(@Body() body: VerifyBody, @Req() req: any) {
    if (!body?.session_token || typeof body.session_token !== 'string') {
      throw new BadRequestException('session_token is required');
    }
    const f = body?.frame;
    if (!f || typeof f.iv !== 'string' || !f.iv || typeof f.tag !== 'string' || !f.tag || typeof f.ciphertext !== 'string' || !f.ciphertext) {
      throw new BadRequestException('frame.iv, frame.tag and frame.ciphertext are required (base64)');
    }
    // /verify is authenticated by the ephemeral, single-use session_token: the plugin runs in the END-USER browser and must not hold the tenant API key.
    const session = await this.sessions.findOne({ where: { sessionToken: body.session_token } });
    if (!session) throw new BadRequestException('invalid session_token');
    const SESSION_TTL_MS = Number(process.env.SESSION_TTL_SECONDS ?? 900) * 1000;
    if (Date.now() - session.createdAt.getTime() > SESSION_TTL_MS) {
      await this.sessions.delete({ id: session.id });
      throw new BadRequestException('session expired');
    }
    // Single-use: consume the token before doing any work so a replay fails with 'invalid session_token'.
    await this.sessions.delete({ id: session.id });
    const tenant = await this.tenants.findOneOrFail({ where: { id: session.tenantId } });
    return this.service.verify({
      transactionId: randomUUID(),
      tenantId: tenant.id,
      rawIp: req.ip ?? '',
      webhookUrl: tenant.webhookUrl,
      webhookSecret: tenant.webhookSecret,
      encryptedFrame: {
        iv: Buffer.from(body.frame.iv, 'base64'),
        tag: Buffer.from(body.frame.tag, 'base64'),
        ciphertext: Buffer.from(body.frame.ciphertext, 'base64'),
      },
    });
  }
}
