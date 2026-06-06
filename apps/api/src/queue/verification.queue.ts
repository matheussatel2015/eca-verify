import { Queue } from 'bullmq';
import { VerificationJob, VERIFICATION_QUEUE_NAME } from './verification-job';

export class VerificationQueue {
  constructor(private readonly queue: Queue) {}

  async enqueue(job: VerificationJob): Promise<void> {
    // jobId = transactionId makes the enqueue idempotent (BullMQ drops duplicate ids).
    await this.queue.add(VERIFICATION_QUEUE_NAME, job, {
      jobId: job.transactionId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: true,
      removeOnFail: false, // keep failed jobs as a dead-letter trail
    });
  }
}
