import { Body, Controller, Post, Req, HttpCode, BadRequestException, UseGuards, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DocumentSession } from '../session/document-session.entity';
import { serializeFrame } from '../storage/frame-codec';
import { FRAME_STORE, FrameStorePort } from '../storage/frame-store.port';
import { DocumentQueue } from '../queue/document.queue';
import { buildDocumentJob } from '../queue/document-job';
import { RateLimitGuard } from '../ratelimit/rate-limit.guard';

interface Img { iv: string; tag: string; ciphertext: string; }
interface DocBody { document_session_token: string; document: Img; selfie: Img; }

function toEncrypted(i: Img) {
  return { iv: Buffer.from(i.iv, 'base64'), tag: Buffer.from(i.tag, 'base64'), ciphertext: Buffer.from(i.ciphertext, 'base64') };
}
function validImg(i: any): i is Img {
  return i && typeof i.iv === 'string' && i.iv && typeof i.tag === 'string' && i.tag && typeof i.ciphertext === 'string' && i.ciphertext;
}

@Controller('verify/document')
@UseGuards(RateLimitGuard)
export class DocumentController {
  constructor(
    @InjectRepository(DocumentSession) private readonly sessions: Repository<DocumentSession>,
    @Inject(FRAME_STORE) private readonly store: FrameStorePort,
    private readonly queue: DocumentQueue,
  ) {}

  @Post()
  @HttpCode(202)
  async submit(@Body() body: DocBody, @Req() req: any) {
    if (!body?.document_session_token || typeof body.document_session_token !== 'string') {
      throw new BadRequestException('document_session_token is required');
    }
    if (!validImg(body.document) || !validImg(body.selfie)) {
      throw new BadRequestException('document and selfie images are required (base64 iv/tag/ciphertext)');
    }
    // Atomic single-use consumption of the document session token (replay-safe).
    // Cross-tenant by design (the plugin holds only the secret token), so it runs through
    // the SECURITY DEFINER consume_document_session() fn rather than relying on RLS bypass.
    const consumedRows = (await this.sessions.manager.query(
      `SELECT tenant_id, transaction_id, created_at FROM consume_document_session($1)`,
      [body.document_session_token],
    )) as Array<{ tenant_id: string; transaction_id: string; created_at: string | Date }>;
    const row = consumedRows?.[0];
    if (!row) throw new BadRequestException('invalid document_session_token');
    const SESSION_TTL_MS = Number(process.env.SESSION_TTL_SECONDS ?? 900) * 1000;
    if (Date.now() - new Date(row.created_at).getTime() > SESSION_TTL_MS) {
      throw new BadRequestException('document session expired');
    }
    const transactionId = row.transaction_id;
    const documentRef = `${transactionId}:doc`;
    const selfieRef = `${transactionId}:self`;
    const ttl = Number(process.env.FRAME_TTL_SECONDS ?? 300);
    await this.store.put(documentRef, serializeFrame(toEncrypted(body.document)), ttl);
    await this.store.put(selfieRef, serializeFrame(toEncrypted(body.selfie)), ttl);
    await this.queue.enqueue(buildDocumentJob({ transactionId, tenantId: row.tenant_id, documentRef, selfieRef, rawIp: req.ip ?? '' }));
    return { transaction_id: transactionId, status: 'processando' };
  }
}
