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
