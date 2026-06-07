export const DOCUMENT_QUEUE_NAME = 'document-verification';

export interface DocumentJob {
  transactionId: string;
  tenantId: string;
  documentRef: string;
  selfieRef: string;
  rawIp: string;
}

export function buildDocumentJob(args: DocumentJob): DocumentJob {
  return {
    transactionId: args.transactionId,
    tenantId: args.tenantId,
    documentRef: args.documentRef,
    selfieRef: args.selfieRef,
    rawIp: args.rawIp,
  };
}
