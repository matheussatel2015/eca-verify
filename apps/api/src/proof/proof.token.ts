// Dedicated DI token for the (optionally absent) proof signer.
// Kept in its own file so the controller can import it without creating a
// circular dependency with proof.module.ts.
export const PROOF_SERVICE = Symbol('PROOF_SERVICE');
