import 'reflect-metadata';
import helmet from 'helmet';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { encryptionKey } from './config';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

// TLS 1.3 is terminated at the reverse proxy (nginx/ALB) in front of this app.
async function bootstrap() {
  try {
    encryptionKey(process.env);
  } catch (e) {
    console.error(`[startup] ${(e as Error).message}`);
    process.exit(1);
  }
  const app = await NestFactory.create(AppModule);
  app.use(helmet());
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.listen(3000);
}
bootstrap().catch((e) => { console.error('[startup] failed:', e); process.exit(1); });
