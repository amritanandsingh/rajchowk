import { describe, expect, it } from 'vitest'
import {
  countWords,
  isStopword,
  markdownToPlain,
  normalizeForSearch,
  readingMinutes,
  slugify,
  tokenize,
  truncateGraphemes,
} from './devanagari'

describe('normalizeForSearch', () => {
  it('returns empty for empty input', () => {
    expect(normalizeForSearch('')).toBe('')
    expect(normalizeForSearch('   ')).toBe('')
  })

  it('folds the nukta so ज़रूरी and जरूरी match', () => {
    // The single most common Hindi spelling variation. Without this fold,
    // half the readers miss half the results.
    expect(normalizeForSearch('ज़रूरी')).toBe(normalizeForSearch('जरूरी'))
    expect(normalizeForSearch('फ़िल्म')).toBe(normalizeForSearch('फिल्म'))
  })

  it('folds precomposed nukta letters to the same form as base + nukta', () => {
    // U+0958 क़ vs क + U+093C. Unicode excludes these from NFC recomposition,
    // so they stay distinct unless handled explicitly.
    const precomposed = 'क़िला' // क़िला
    const decomposed = 'क़िला' // क + nukta + िला
    expect(precomposed).not.toBe(decomposed)
    expect(normalizeForSearch(precomposed)).toBe(normalizeForSearch(decomposed))
  })

  it('folds conjunct nasals to anusvara so सम्बन्ध matches संबंध', () => {
    expect(normalizeForSearch('सम्बन्ध')).toBe(normalizeForSearch('संबंध'))
    expect(normalizeForSearch('अन्त')).toBe(normalizeForSearch('अंत'))
  })

  it('strips zero-width joiners, which keyboards insert inconsistently', () => {
    expect(normalizeForSearch('क‍ख')).toBe(normalizeForSearch('कख'))
    expect(normalizeForSearch('क‌ख')).toBe(normalizeForSearch('कख'))
  })

  it('converts Devanagari digits to ASCII', () => {
    expect(normalizeForSearch('२०२६')).toBe('2026')
    expect(normalizeForSearch('धारा ३७०')).toBe('धारा 370')
  })

  it('lowercases the Latin portion of code-mixed text', () => {
    expect(normalizeForSearch('Delhi में बड़ा फैसला')).toContain('delhi')
  })

  it('strips danda and double danda', () => {
    expect(normalizeForSearch('यह सच है।')).toBe('यह सच है')
    expect(normalizeForSearch('श्लोक॥')).toBe('श्लोक')
  })

  it('collapses whitespace', () => {
    expect(normalizeForSearch('  राज    चौक  ')).toBe('राज चौक')
    expect(normalizeForSearch('राज\n\tचौक')).toBe('राज चौक')
  })

  it('is idempotent', () => {
    const once = normalizeForSearch('ज़रूरी सम्बन्ध २०२६।')
    expect(normalizeForSearch(once)).toBe(once)
  })
})

describe('tokenize', () => {
  it('splits on whitespace', () => {
    expect(tokenize('राज चौक समाचार')).toEqual(['राज', 'चौक', 'समाचार'])
  })

  it('removes Hindi stopwords', () => {
    const tokens = tokenize('दिल्ली में बड़ा फैसला')
    expect(tokens).not.toContain('में')
    expect(tokens).toContain('दिल्ली')
    expect(tokens).toContain('फैसला')
  })

  it('removes English stopwords from code-mixed text', () => {
    expect(tokenize('the Delhi verdict')).toEqual(['delhi', 'verdict'])
  })

  it('deduplicates', () => {
    expect(tokenize('चुनाव चुनाव चुनाव')).toEqual(['चुनाव'])
  })

  it('drops single characters as index noise', () => {
    expect(tokenize('क ख राजनीति')).toEqual(['राजनीति'])
  })

  it('caps the token count', () => {
    const many = Array.from({ length: 200 }, (_, i) => `शब्द${i}`).join(' ')
    expect(tokenize(many).length).toBeLessThanOrEqual(60)
    expect(tokenize(many, { maxTokens: 10 })).toHaveLength(10)
  })

  it('returns an empty array for empty or stopword-only input', () => {
    expect(tokenize('')).toEqual([])
    expect(tokenize('   ')).toEqual([])
    expect(tokenize('का के की')).toEqual([])
  })

  it('produces the SAME tokens for spelling variants — the property the index depends on', () => {
    // If the write path and the query path ever disagree here, indexed
    // documents become permanently unreachable.
    expect(tokenize('ज़रूरी सम्बन्ध')).toEqual(tokenize('जरूरी संबंध'))
  })
})

describe('isStopword', () => {
  it('recognises stopwords through normalisation', () => {
    expect(isStopword('में')).toBe(true)
    expect(isStopword('the')).toBe(true)
    expect(isStopword('THE')).toBe(true)
  })

  it('does not treat content words as stopwords', () => {
    expect(isStopword('चुनाव')).toBe(false)
  })
})

describe('markdownToPlain', () => {
  it('strips headings, emphasis and list markers', () => {
    expect(markdownToPlain('## शीर्षक\n\n**मोटा** और _तिरछा_')).toBe('शीर्षक मोटा और तिरछा')
    expect(markdownToPlain('- पहला\n- दूसरा')).toBe('पहला दूसरा')
  })

  it('keeps link and image text but drops the URL', () => {
    expect(markdownToPlain('[राज चौक](https://rajchowk.in)')).toBe('राज चौक')
    expect(markdownToPlain('![तस्वीर](https://x/y.jpg)')).toBe('तस्वीर')
  })

  it('removes code blocks and inline code', () => {
    expect(markdownToPlain('पहले\n\n```\ncode here\n```\n\nबाद में')).toBe('पहले बाद में')
    expect(markdownToPlain('यह `कोड` है')).toBe('यह है')
  })

  it('removes custom directives', () => {
    expect(markdownToPlain('पहले\n\n::youtube{id=dQw4w9WgXcQ}\n\nबाद में')).toBe('पहले बाद में')
  })

  it('strips blockquotes and horizontal rules', () => {
    expect(markdownToPlain('> उद्धरण')).toBe('उद्धरण')
    expect(markdownToPlain('ऊपर\n\n---\n\nनीचे')).toBe('ऊपर नीचे')
  })
})

describe('countWords / readingMinutes', () => {
  it('counts space-delimited words in both scripts', () => {
    expect(countWords('राज चौक समाचार')).toBe(3)
    expect(countWords('Delhi में फैसला')).toBe(3)
    expect(countWords('')).toBe(0)
    expect(countWords('   ')).toBe(0)
  })

  it('uses 200 wpm, not the 265 wpm Latin default', () => {
    // 400 words is two minutes of Hindi, not 1.5 of English.
    expect(readingMinutes(Array(400).fill('शब्द').join(' '))).toBe(2)
    expect(readingMinutes(Array(200).fill('शब्द').join(' '))).toBe(1)
  })

  it('rounds up, and never reports zero for non-empty text', () => {
    expect(readingMinutes('एक शब्द')).toBe(1)
    expect(readingMinutes(Array(201).fill('शब्द').join(' '))).toBe(2)
  })

  it('reports zero for empty text', () => {
    expect(readingMinutes('')).toBe(0)
  })
})

describe('truncateGraphemes', () => {
  it('leaves short strings untouched', () => {
    expect(truncateGraphemes('राज चौक', 20)).toBe('राज चौक')
  })

  it('does not split a Devanagari grapheme cluster', () => {
    // A naive UTF-16 slice can separate a consonant from its matra and render
    // a visibly broken glyph. The property to assert is that the output is a
    // whole-grapheme prefix of the input — NOT that it avoids ending in a
    // matra, since a complete cluster like 'ति' legitimately does.
    const input = 'राजनीति समाचार'
    const result = truncateGraphemes(input, 5)
    expect(result.endsWith('…')).toBe(true)

    const segmenter = new Intl.Segmenter('hi', { granularity: 'grapheme' })
    const graphemesOf = (value: string) => [...segmenter.segment(value)].map((s) => s.segment)

    const body = result.slice(0, -1)
    const bodyGraphemes = graphemesOf(body)
    expect(bodyGraphemes.length).toBeLessThanOrEqual(5)
    // Every cluster in the output must appear intact at the same position in
    // the input — that is what "did not split a cluster" actually means.
    expect(bodyGraphemes).toEqual(graphemesOf(input).slice(0, bodyGraphemes.length))
  })

  it('never emits a partial cluster at any truncation length', () => {
    const input = 'राजनीति समाचार क़िला ज़रूरी'
    const segmenter = new Intl.Segmenter('hi', { granularity: 'grapheme' })
    const all = [...segmenter.segment(input)].map((s) => s.segment)

    for (let n = 1; n <= all.length; n += 1) {
      const body = truncateGraphemes(input, n).replace(/…$/, '')
      const bodyGraphemes = [...segmenter.segment(body)].map((s) => s.segment)
      expect(bodyGraphemes).toEqual(all.slice(0, bodyGraphemes.length))
    }
  })

  it('handles empty input', () => {
    expect(truncateGraphemes('', 10)).toBe('')
  })

  it('accepts a custom ellipsis', () => {
    expect(truncateGraphemes('राजनीति समाचार', 4, '...')).toMatch(/\.\.\.$/)
  })
})

describe('slugify', () => {
  it('keeps Devanagari rather than transliterating it', () => {
    // Transliteration needs a mapping table that mangles proper nouns, and
    // percent-encoded Devanagari breaks when pasted into WhatsApp.
    expect(slugify('दिल्ली में बड़ा फैसला')).toBe('दिल्ली-में-बड़ा-फैसला')
  })

  it('lowercases and hyphenates Latin', () => {
    expect(slugify('Big Verdict In Delhi')).toBe('big-verdict-in-delhi')
  })

  it('handles code-mixed titles', () => {
    expect(slugify('Delhi में फैसला')).toBe('delhi-में-फैसला')
  })

  it('strips punctuation, including danda', () => {
    expect(slugify('यह सच है। सच!')).toBe('यह-सच-है-सच')
    expect(slugify('क्या, कब; कैसे?')).toBe('क्या-कब-कैसे')
  })

  it('collapses and trims hyphens', () => {
    expect(slugify('  राज —— चौक  ')).toBe('राज-चौक')
    expect(slugify('---राज---')).toBe('राज')
  })

  it('truncates at a word boundary', () => {
    const slug = slugify('a'.repeat(40) + ' ' + 'b'.repeat(60), { maxLength: 50 })
    expect(slug.length).toBeLessThanOrEqual(50)
    expect(slug.endsWith('-')).toBe(false)
  })

  it('does not leave a trailing hyphen when truncating mid-word', () => {
    expect(slugify('क'.repeat(200)).endsWith('-')).toBe(false)
  })

  it('returns empty for input with nothing sluggable', () => {
    expect(slugify('!!!')).toBe('')
    expect(slugify('')).toBe('')
  })

  it('is stable across nukta encodings', () => {
    expect(slugify('क़िला')).toBe(slugify('क़िला'))
  })
})
