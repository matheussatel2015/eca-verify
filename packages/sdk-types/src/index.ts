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

// Faixas etárias (defaults sensatos alinhados ao ECA — CONFIRMAR COM JURÍDICO).
export const AGE_BANDS = ['crianca', 'adolescente_jovem', 'adolescente', 'adulto'] as const;
export type AgeBand = typeof AGE_BANDS[number];

export interface WebhookPayload {
  transaction_id: string;
  status: VerificationStatus;
  is_over_18: boolean;
  document_session_token?: string;
  proof?: string; // signed ES256 JWT verification receipt
  age_band?: AgeBand; // faixa etária derivada (opcional)
}

// Fields that must NEVER appear in a session-open payload (PII guard).
export const FORBIDDEN_PII_FIELDS = ['nome', 'name', 'cpf', 'email', 'e_mail', 'telefone', 'celular', 'phone', 'rg', 'data_nascimento', 'birth_date'] as const;
