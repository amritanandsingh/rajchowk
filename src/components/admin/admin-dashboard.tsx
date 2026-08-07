'use client'

import Link from 'next/link'
import { FileText, MessageSquareWarning, Radio, Vote } from 'lucide-react'
import { isStaff } from '@/lib/domain/staff-role'
import { cardVariants } from '@/components/ui/card'
import { cn } from '@/lib/utils/cn'
import { useStaffGroups } from './use-staff-groups'

const cards = [
  {
    href: '/admin/articles',
    title: 'लेख',
    description: 'ड्राफ़्ट, समीक्षा और प्रकाशन',
    Icon: FileText,
  },
  {
    href: '/admin/moderation',
    title: 'मॉडरेशन',
    description: 'टिप्पणियाँ, सवाल और रिपोर्ट',
    Icon: MessageSquareWarning,
  },
  { href: '/janmat', title: 'जनमत', description: 'लाइव पोल का सार्वजनिक दृश्य', Icon: Vote },
  { href: '/live', title: 'लाइव', description: 'आगामी और चल रही चर्चाएँ', Icon: Radio },
]

export function AdminDashboard() {
  // Was a second, independent fetchAuthSession() alongside the one in
  // useStaffGroups — the same token decoded twice on the same page. The hook
  // now shares one promise across every staff component, and `isStaff` keeps
  // the group list from being spelled out a second time here.
  const { groups, ready } = useStaffGroups()

  if (!ready) return <p role="status">अनुमति जाँची जा रही है…</p>
  if (!isStaff(groups))
    return (
      <div className="rounded-card bg-danger-subtle p-5 text-danger" role="alert">
        <h2 className="font-display text-xl font-bold">प्रवेश निषिद्ध</h2>
        <p className="mt-2 text-sm">यह क्षेत्र केवल अधिकृत स्टाफ के लिए है।</p>
      </div>
    )
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {cards.map(({ href, title, description, Icon }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            cardVariants({ variant: 'surface', padding: 'md' }),
            'group text-fg no-underline transition-colors hover:border-brand motion-reduce:transition-none',
          )}
        >
          <Icon aria-hidden="true" className="size-7 text-brand" />
          <h2 className="mt-4 text-xl font-bold group-hover:text-brand">{title}</h2>
          <p className="mt-2 text-sm text-fg-muted">{description}</p>
        </Link>
      ))}
    </div>
  )
}
