import { buildDocumentJob, DOCUMENT_QUEUE_NAME } from './document-job';

test('builds a document job with both image refs', () => {
  const job = buildDocumentJob({ transactionId: 't1', tenantId: 'ten1', documentRef: 't1:doc', selfieRef: 't1:self', rawIp: '1.2.3.4' });
  expect(job).toEqual({ transactionId: 't1', tenantId: 'ten1', documentRef: 't1:doc', selfieRef: 't1:self', rawIp: '1.2.3.4' });
  expect(DOCUMENT_QUEUE_NAME).toBe('document-verification');
});
