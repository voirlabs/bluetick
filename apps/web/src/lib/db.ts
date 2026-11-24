import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }

function databaseUrl() {
  const base = process.env['DATABASE_URL'] ?? ''
  // On Vercel every warm instance holds its own pool, so keep each one to a
  // single connection to stay under the database's connection cap.
  if (!process.env['VERCEL']) return base
  try {
    const url = new URL(base)
    if (!url.searchParams.has('connection_limit')) url.searchParams.set('connection_limit', '1')
    if (!url.searchParams.has('pool_timeout')) url.searchParams.set('pool_timeout', '20')
    return url.toString()
  } catch {
    return base
  }
}

export const db =
  globalForPrisma.prisma ?? new PrismaClient({ datasources: { db: { url: databaseUrl() } } })

// Reuse one client across hot reloads in dev and module re-evaluation in prod.
globalForPrisma.prisma = db
