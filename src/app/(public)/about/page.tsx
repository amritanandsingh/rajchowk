import type { Metadata } from 'next'
import { PageHeader } from '@/components/site/page-header'

export const metadata: Metadata = { title: 'हमारे बारे में', alternates: { canonical: '/about' } }
export default function AboutPage() {
  return (
    <main id="content" tabIndex={-1} className="mx-auto max-w-3xl px-4 py-10">
      <PageHeader
        title="हमारे बारे में"
        description="राज चौक खबर, विश्लेषण और नागरिक भागीदारी का स्वतंत्र हिंदी मंच है।"
      />
      <div className="space-y-8 text-lg leading-8">
        <section>
          <h2 className="text-2xl font-bold">हमारा मकसद</h2>
          <p className="mt-3">
            जटिल सार्वजनिक मुद्दों को सरल बनाना, तथ्य और राय के बीच स्पष्ट रेखा रखना, और सत्ता को
            उसके वादों पर जवाबदेह बनाना।
          </p>
        </section>
        <section>
          <h2 className="text-2xl font-bold">हम कैसे काम करते हैं</h2>
          <p className="mt-3">
            हर लेख में स्रोत, तथ्यात्मक सार, विश्लेषण और निष्कर्ष को अलग रखा जाता है। गलती होने पर
            हम उसे खुले तौर पर दर्ज और सुधारते हैं।
          </p>
        </section>
      </div>
    </main>
  )
}
