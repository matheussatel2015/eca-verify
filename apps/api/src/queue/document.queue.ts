import { Queue } from 'bullmq';
import { DocumentJob, DOCUMENT_QUEUE_NAME } from './document-job';

export class DocumentQueue {
  constructor(private readonly queue: Queue) {}
  async enqueue(job: DocumentJob): Promise<void> {
    await this.queue.add(DOCUMENT_QUEUE_NAME, job, {
      jobId: `doc-${job.transactionId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: true,
      removeOnFail: false,
    });
  }
}
