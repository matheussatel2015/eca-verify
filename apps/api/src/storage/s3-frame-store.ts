import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { FrameStorePort } from './frame-store.port';

export class S3FrameStore implements FrameStorePort {
  constructor(private readonly s3: S3Client, private readonly bucket: string) {}

  async put(key: string, data: Buffer, ttlSeconds: number): Promise<void> {
    // Expires header is a hint; the bucket lifecycle rule is the real TTL backstop.
    const expires = new Date(Date.now() + ttlSeconds * 1000);
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, Expires: expires }));
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const bytes = await res.Body!.transformToByteArray();
      return Buffer.from(bytes);
    } catch (e: any) {
      if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return null;
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
