import type { Metadata } from 'next'
import { PageHeader } from '@/components/site/page-header'
import { Container } from '@/components/ui/container'
export const metadata: Metadata = {
  title: 'सुधार नीति',
  alternates: { canonical: '/corrections-policy' },
}
export default function CorrectionsPolicyPage() {
  return (
    <Container width="prose">
      <PageHeader title="सुधार नीति" description="पारदर्शिता विश्वास की पहली शर्त है।" />
      <div className="space-y-5 leading-7">
        <p>
          तथ्यात्मक गलती मिलने पर हम लेख को जल्द से जल्द ठीक करते हैं और सुधार नोटिस में बताते हैं
          कि क्या बदला और कब।
        </p>
        <p>
          टाइपो जैसे अर्थहीन बदलाव और महत्वपूर्ण तथ्यात्मक सुधार में स्पष्ट अंतर रखा जाता है। लेख की
          सुधार तारीख पाठक को दिखाई जाती है।
        </p>
        <p>
          संभावित गलती बताने के लिए <a href="/contact">संपर्क पृष्ठ</a> का उपयोग करें।
        </p>
      </div>
    </Container>
  )
}
