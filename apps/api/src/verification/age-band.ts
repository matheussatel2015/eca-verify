import { AgeBand } from '@eca/sdk-types';

/**
 * Limiares das faixas etárias.
 * DEFAULTS SENSATOS alinhados aos marcos clássicos do ECA (12 e 16) — NÃO são
 * imposição literal da Lei 15.211/2025. CONFIRMAR COM JURÍDICO antes de produção.
 * Centralizados aqui para troca trivial.
 */
export const AGE_BAND_THRESHOLDS = {
  crianca: 12, // idade < 12 → crianca
  adolescenteJovem: 16, // 12..15 → adolescente_jovem
  adulto: 18, // 16..17 → adolescente ; >= 18 → adulto
} as const;

/** Mapa puro idade → faixa. Retorna null quando a idade é desconhecida. */
export function classifyAgeBand(age: number | null | undefined): AgeBand | null {
  if (age === null || age === undefined || !Number.isFinite(age)) return null;
  if (age < AGE_BAND_THRESHOLDS.crianca) return 'crianca';
  if (age < AGE_BAND_THRESHOLDS.adolescenteJovem) return 'adolescente_jovem';
  if (age < AGE_BAND_THRESHOLDS.adulto) return 'adolescente';
  return 'adulto';
}
