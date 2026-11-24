/**
 * What the webhook has seen lately, for the setup checklist: when Meta last
 * failed the verify-token handshake, and when a delivery last failed the
 * signature check. Kept in memory, so it resets on restart and each serverless
 * instance has its own; it's a hint for setup, not an audit log.
 */
interface Health {
  verifyFailedAt: Date | null
  signatureFailedAt: Date | null
}

const g = globalThis as unknown as { __webhookHealth?: Health }
const health = (g.__webhookHealth ??= { verifyFailedAt: null, signatureFailedAt: null })

export function recordVerifyFailure(now = new Date()) {
  health.verifyFailedAt = now
}

export function recordSignatureFailure(now = new Date()) {
  health.signatureFailedAt = now
}

export function webhookHealth(): Readonly<Health> {
  return { ...health }
}
