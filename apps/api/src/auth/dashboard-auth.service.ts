import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { SignJWT, jwtVerify } from 'jose';
import { DashboardUser } from './dashboard-user.entity';
import { hashPassword, verifyPassword } from './password';

export interface DashboardClaims {
  userId: string;
  tenantId: string;
  email: string;
}

@Injectable()
export class DashboardAuthService {
  private readonly key: Uint8Array;
  constructor(
    @InjectRepository(DashboardUser) private readonly users: Repository<DashboardUser>,
    private readonly secret: string,
    private readonly ttl: string,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  async createUser(tenantId: string, email: string, password: string): Promise<DashboardUser> {
    const user: DashboardUser = {
      id: randomUUID(),
      tenantId,
      email: email.toLowerCase(),
      passwordHash: hashPassword(password),
      createdAt: new Date(),
    };
    await this.users.save(user);
    return user;
  }

  async login(email: string, password: string): Promise<DashboardUser | null> {
    const user = await this.users.findOne({ where: { email: email.toLowerCase() } });
    if (!user) return null;
    return verifyPassword(password, user.passwordHash) ? user : null;
  }

  async issueToken(user: Pick<DashboardUser, 'id' | 'tenantId' | 'email'>): Promise<string> {
    return new SignJWT({ tenant_id: user.tenantId, email: user.email })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime(this.ttl)
      .sign(this.key);
  }

  async verifyToken(token: string): Promise<DashboardClaims> {
    const { payload } = await jwtVerify(token, this.key);
    return { userId: String(payload.sub), tenantId: String(payload.tenant_id), email: String(payload.email) };
  }
}
