export const VERIFICATION_STATUSES = ['aprovado', 'reprovado', 'documento_requerido'] as const;
export type VerificationStatus = typeof VERIFICATION_STATUSES[number];

export function isVerificationStatus(v: unknown): v is VerificationStatus {
  return typeof v === 'string' && (VERIFICATION_STATUSES as readonly string[]).includes(v);
}

export interface AgeProviderResult {
  estimatedAge: number;
  livenessScore: number; // 0..1
}

export interface DecisionConfig {
  cutoffAge: number;
  margin: number;
  livenessThreshold: number;
}

export interface WebhookPayload {
  transaction_id: string;
  status: VerificationStatus;
  is_over_18: boolean;
  document_session_token?: string;
}

// Fields that must NEVER appear in a session-open payload (PII guard).
export const FORBIDDEN_PII_FIELDS = ['nome', 'name', 'cpf', 'email', 'e_mail', 'telefone', 'celular', 'phone', 'rg', 'data_nascimento', 'birth_date'] as const;
