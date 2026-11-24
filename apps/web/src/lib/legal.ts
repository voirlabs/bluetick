import { getAgent } from '@/lib/agent/definition'

/** When the wording of /privacy and /data-deletion last changed. */
export const LEGAL_UPDATED = '24 November 2026'

export interface Operator {
  /** The business that runs this deployment, from the agent's business details. */
  name: string | null
  /** PRIVACY_CONTACT_EMAIL, if set. */
  email: string | null
}

/** Who runs this deployment and how customers reach them about their data. */
export async function getOperator(): Promise<Operator> {
  const email = process.env['PRIVACY_CONTACT_EMAIL']?.trim() || null
  // The pages must render even if the database is down.
  const agent = await getAgent().catch(() => null)
  const business = agent?.businessContext
  const name =
    business && typeof business === 'object' && !Array.isArray(business)
      ? (business as { businessName?: unknown }).businessName
      : null
  return { name: typeof name === 'string' && name.trim() ? name.trim() : null, email }
}
