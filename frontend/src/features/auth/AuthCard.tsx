import type { ReactNode } from 'react'
import { Tagline } from '../../ui/Tagline'

/** Log in and register: one centred card on the page ground (ADR-032). */
export function AuthCard({ title, children, footer }: { title: string; children: ReactNode; footer: ReactNode }) {
  return (
    <main className="flex justify-center p-4 py-10 sm:py-16">
      <section className="flex w-full max-w-sm flex-col gap-5 rounded-card border border-line bg-surface p-6 sm:p-8">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-2xl font-bold">{title}</h1>
          <Tagline className="text-sm" />
        </div>
        {children}
        <p className="m-0 text-sm text-muted">{footer}</p>
      </section>
    </main>
  )
}
