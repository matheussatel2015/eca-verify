export interface ConsentState {
  consentGiven: boolean;
}

/** The camera must never be activated before explicit consent (LGPD). */
export function canActivateCamera(state: ConsentState): boolean {
  return state.consentGiven === true;
}
