import { Body, Controller, Post, Req, HttpCode, BadRequestException, UseGuards, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { VerificationSession } from '../session/session.entity';
import { serializeFrame } from '../storage/frame-codec';
import { FRAME_STORE, FrameStorePort } from '../storage/frame-store.port';
import { VerificationQueue } from '../queue/verification.queue';
import { buildVerificationJob } from '../queue/verification-job';
import { RateLimitGuard } from '../ratelimit/rate-limit.guard';

interface VerifyBody {
  session_token: string;
  frame: { iv: string; tag: string; ciphertext: string }; // base64
}

@Controller('verify')
@UseGuards(RateLimitGuard)
export class VerificationController {
  constructor(
    @InjectRepository(VerificationSession) private readonly sessions: Repository<VerificationSession>,
    @Inject(FRAME_STORE) private readonly store: FrameStorePort,
    private readonly queue: VerificationQueue,
  ) {}

  @Post()
  @HttpCode(202)
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
    // Single-use: consume the token before enqueueing so a replay fails with 'invalid session_token'.
    await this.sessions.delete({ id: session.id });

    const transactionId = randomUUID();
    const frameRef = transactionId;
    const encryptedFrame = {
      iv: Buffer.from(body.frame.iv, 'base64'),
      tag: Buffer.from(body.frame.tag, 'base64'),
      ciphertext: Buffer.from(body.frame.ciphertext, 'base64'),
    };
    const ttl = Number(process.env.FRAME_TTL_SECONDS ?? 300);
    await this.store.put(frameRef, serializeFrame(encryptedFrame), ttl);
    await this.queue.enqueue(buildVerificationJob({
      transactionId,
      tenantId: session.tenantId,
      frameRef,
      rawIp: req.ip ?? '',
    }));

    return { transaction_id: transactionId, status: 'processando' };
  }
}
