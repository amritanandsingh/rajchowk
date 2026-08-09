import type { Metadata } from 'next'
import { PageHeader } from '@/components/site/page-header'
import { Container } from '@/components/ui/container'
export const metadata: Metadata = {
  title: 'संपादकीय नीति',
  alternates: { canonical: '/editorial-policy' },
}
export default function EditorialPolicyPage() {
  return (
    <Container width="prose">
      <PageHeader title="संपादकीय नीति" />
      <div className="space-y-7 leading-7">
        <section>
          <h2 className="text-xl font-bold">तथ्य और राय</h2>
          <p className="mt-2">
            खबर, विश्लेषण, राय और प्रायोजित सामग्री को अलग चिह्नित किया जाता है।
          </p>
        </section>
        <section>
          <h2 className="text-xl font-bold">स्रोत और सत्यापन</h2>
          <p className="mt-2">
            हम मूल दस्तावेज़, आधिकारिक रिकॉर्ड और स्वतंत्र पुष्टि को प्राथमिकता देते हैं। गोपनीय
            स्रोत का उपयोग केवल सार्वजनिक हित में किया जाता है।
          </p>
        </section>
        <section>
          <h2 className="text-xl font-bold">स्वतंत्रता</h2>
          <p className="mt-2">
            राजनीतिक दल, सरकार, विज्ञापनदाता या अन्य बाहरी हित संपादकीय निष्कर्ष तय नहीं करते।
          </p>
        </section>
      </div>
    </Container>
  )
}
