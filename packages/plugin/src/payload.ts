export interface RawEncryptedFrame {
  iv: Buffer;
  tag: Buffer;
  ciphertext: Buffer;
}

export function buildVerifyPayload(sessionToken: string, frame: RawEncryptedFrame) {
  return {
    session_token: sessionToken,
    frame: {
      iv: frame.iv.toString('base64'),
      tag: frame.tag.toString('base64'),
      ciphertext: frame.ciphertext.toString('base64'),
    },
  };
}

export interface SessionOpenInput {
  userHash: string;
  policyVersion: string;
  consentGiven: boolean;
}

// Sent by the tenant backend (or plugin bootstrap) to POST /sessions.
export function buildSessionOpenPayload(input: SessionOpenInput) {
  return {
    user_hash: input.userHash,
    policy_version: input.policyVersion,
    consent: input.consentGiven === true,
  };
}
