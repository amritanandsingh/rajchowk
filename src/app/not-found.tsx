import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
export default function NotFound() {
  return (
    <main
      id="content"
      className="mx-auto flex min-h-[55vh] max-w-2xl flex-col items-center justify-center px-4 py-16 text-center"
    >
      <p className="text-sm font-bold text-accent">404</p>
      <h1 className="mt-2 font-display text-4xl font-bold">पृष्ठ नहीं मिला</h1>
      <p className="mt-3 text-fg-muted">यह पता मौजूद नहीं है या सामग्री हटा दी गई है।</p>
      <Link
        href="/"
        className={buttonVariants({ variant: 'primary', size: 'md', className: 'mt-6' })}
      >
        होम पर जाएँ
      </Link>
    </main>
  )
}
