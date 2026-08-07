import type { Metadata } from 'next'
import { PageHeader } from '@/components/site/page-header'
import { Container } from '@/components/ui/container'
export const metadata: Metadata = { title: 'संपर्क', alternates: { canonical: '/contact' } }
export default function ContactPage() {
  return (
    <Container width="prose">
      <PageHeader
        title="संपर्क"
        description="पाठकों की प्रतिक्रिया हमारी पत्रकारिता को बेहतर बनाती है।"
      />
      <div className="rounded-card border border-border bg-surface p-6 shadow-card">
        <h2 className="text-xl font-bold">संपादकीय और सुधार</h2>
        <p className="mt-3">
          खबर सुझाव, सुधार या सामान्य प्रतिक्रिया:{' '}
          <a href="mailto:hello@rajchowk.in">hello@rajchowk.in</a>
        </p>
        <p className="mt-3 text-sm text-fg-muted">
          कृपया संबंधित लेख का लिंक और जिस अंश पर आपत्ति है उसका स्पष्ट विवरण भेजें।
        </p>
      </div>
    </Container>
  )
}
