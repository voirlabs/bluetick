import { Lockup } from '@/components/lockup'
import { setupProblem } from '@/lib/auth'
import { APP_NAME } from '@/lib/site'
import { LoginForm } from './login-form'

// Reads the server's environment on each request, not at build time.
export const dynamic = 'force-dynamic'

export default function LoginPage() {
  const problem = setupProblem()
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <Lockup size={34} className="mb-10" />
      <div className="w-full max-w-sm rounded-xl border border-card-line bg-card p-6 sm:p-8">
        <h1 className="display mb-2 text-[32px]">
          Sign <span className="text-accent">in</span>
        </h1>
        <p className="mb-6 text-sm text-muted">
          {problem
            ? `${APP_NAME} isn't set up yet.`
            : "Sign in with this deployment's admin password."}
        </p>
        {problem ? (
          <p
            role="alert"
            className="rounded-lg border border-danger/35 bg-danger/[0.07] px-3 py-3 text-sm leading-relaxed text-text"
          >
            {problem}
          </p>
        ) : (
          <LoginForm />
        )}
      </div>
    </main>
  )
}
