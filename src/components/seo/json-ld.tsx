/* eslint-disable no-restricted-syntax --
 * Sanctioned dangerouslySetInnerHTML #2 of 2 (the other is theme-script.tsx).
 *
 * A JSON-LD block has to be a real <script type="application/ld+json"> element
 * with text content — React cannot express that any other way, and next/script
 * is explicitly the wrong tool (it defers and relocates the tag, and crawlers
 * miss it).
 *
 * The content is server-generated from our own database and passed through
 * JSON.stringify, then every "<" is escaped to <. That escape is the part
 * that matters: JSON.stringify alone does NOT prevent a "</script>" sequence
 * inside a string value from closing the tag early, which is the one XSS
 * vector this element has.
 */
import type { Thing, WithContext } from 'schema-dts'

export function JsonLd({ data }: { data: WithContext<Thing> | WithContext<Thing>[] }) {
  const payload = Array.isArray(data) ? data : [data]

  return (
    <>
      {payload.map((entry, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(entry).replace(/</g, '\\u003c'),
          }}
        />
      ))}
    </>
  )
}
