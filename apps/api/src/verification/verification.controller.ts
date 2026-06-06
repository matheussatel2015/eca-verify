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
    const session = await this.sessions.findOne({ where: { sessionToken: body.session_token } });
    if (!session) throw new BadRequestException('invalid session_token');
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
