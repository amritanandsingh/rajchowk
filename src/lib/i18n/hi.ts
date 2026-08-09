/**
 * Every user-visible string in the application, in one place.
 *
 * WHY A MODULE AND NOT JUST INLINE TEXT. Two reasons, both practical rather
 * than ideological. Devanagari inline in JSX is hard to review in a diff — a
 * changed matra is nearly invisible — and having one file makes a copy change
 * a one-file change. It also means a proof-reader can read the product's whole
 * voice without opening twenty components.
 *
 * HINDI ONLY, ON PURPOSE. There is no `en.ts` and no locale switcher: nothing
 * in the specification asks for one, and a bilingual dictionary layer with a
 * single language in it is scaffolding pretending to be a feature. The shape
 * below is a plain nested object, so adding `en.ts` later and selecting
 * between them is a change to this module and not to any call site.
 */
export const hi = {
  siteName: 'राज चौक',
  tagline: 'विचार और विश्लेषण',

  nav: {
    home: 'मुखपृष्ठ',
    skipToContent: 'मुख्य सामग्री पर जाएँ',
  },

  feed: {
    heading: 'ताज़ा लेख',
    empty: {
      title: 'अभी कोई लेख प्रकाशित नहीं हुआ है',
      description: 'जैसे ही पहला लेख प्रकाशित होगा, वह यहाँ दिखाई देगा।',
    },
    error: {
      title: 'लेख नहीं लाए जा सके',
      description: 'कुछ तकनीकी गड़बड़ हुई है। कृपया थोड़ी देर बाद पृष्ठ ताज़ा करें।',
      retry: 'दोबारा कोशिश करें',
    },
    readMore: 'पूरा पढ़ें',
  },

  article: {
    publishedOn: 'प्रकाशित',
    updatedOn: 'अद्यतन',
    by: 'लेखक',
    backToFeed: 'सभी लेख',
    notFound: {
      title: 'यह लेख नहीं मिला',
      description: 'हो सकता है यह हटा दिया गया हो या पता बदल गया हो।',
    },
  },

  admin: {
    title: 'संपादकीय डैशबोर्ड',
    description: 'लेख लिखें, सहेजें और प्रकाशित करें।',
    signOut: 'साइन आउट',
    newArticle: 'नया लेख',

    login: {
      title: 'प्रशासक साइन इन',
      description: 'यह क्षेत्र केवल अधिकृत संपादकों के लिए है।',
      email: 'ईमेल',
      password: 'पासवर्ड',
      submit: 'साइन इन करें',
      submitting: 'साइन इन हो रहा है…',
      newPassword: 'नया पासवर्ड',
      newPasswordHint: 'कम से कम 12 अक्षर, जिनमें बड़े-छोटे अक्षर, अंक और चिह्न हों।',
      newPasswordTitle: 'नया पासवर्ड सेट करें',
      newPasswordDescription: 'पहली बार साइन इन करने पर अस्थायी पासवर्ड बदलना ज़रूरी है।',
      confirmSubmit: 'पासवर्ड सेट करें',
      failed: 'ईमेल या पासवर्ड सही नहीं है।',
      notAdmin: 'इस खाते के पास प्रशासक अधिकार नहीं हैं।',
    },

    list: {
      drafts: 'ड्राफ़्ट',
      published: 'प्रकाशित',
      emptyDrafts: {
        title: 'कोई ड्राफ़्ट नहीं है',
        description: 'नया लेख लिखकर शुरुआत करें।',
      },
      emptyPublished: {
        title: 'अभी कुछ प्रकाशित नहीं हुआ',
        description: 'ड्राफ़्ट तैयार होने पर उसे प्रकाशित करें।',
      },
      error: {
        title: 'सूची नहीं लाई जा सकी',
        description: 'कृपया पृष्ठ ताज़ा करें।',
      },
      edit: 'संपादित करें',
      view: 'देखें',
    },

    form: {
      newTitle: 'नया लेख',
      editTitle: 'लेख संपादित करें',
      title: 'शीर्षक',
      titlePlaceholder: 'लेख का शीर्षक',
      summary: 'सारांश',
      summaryHint: 'फ़ीड में दिखने वाली एक-दो पंक्तियाँ।',
      content: 'लेख',
      contentHint: 'मार्कडाउन चलेगा — ## उपशीर्षक, **मोटा**, [कड़ी](https://…)।',
      slug: 'URL (वैकल्पिक)',
      slugHint: 'खाली छोड़ने पर अपने आप बन जाएगा। केवल छोटे अंग्रेज़ी अक्षर, अंक और हाइफ़न।',
      save: 'ड्राफ़्ट सहेजें',
      saving: 'सहेजा जा रहा है…',
      saveAndPublish: 'सहेजें और प्रकाशित करें',
      publishing: 'प्रकाशित हो रहा है…',
      saved: 'सहेज लिया गया।',
      published: 'लेख प्रकाशित हो गया।',
      unpublished: 'लेख फ़ीड से हटा दिया गया।',
      cancel: 'रद्द करें',
    },

    actions: {
      PUBLISH: 'प्रकाशित करें',
      UNPUBLISH: 'फ़ीड से हटाएँ',
    },

    status: {
      DRAFT: 'ड्राफ़्ट',
      PUBLISHED: 'प्रकाशित',
    },
  },

  error: {
    title: 'कुछ गड़बड़ हो गई',
    description: 'यह पृष्ठ अभी दिखाया नहीं जा सका।',
    retry: 'दोबारा कोशिश करें',
    home: 'मुखपृष्ठ पर जाएँ',
  },

  notFound: {
    title: 'पृष्ठ नहीं मिला',
    description: 'जिस पते पर आप पहुँचे हैं, वहाँ कुछ नहीं है।',
  },

  loading: 'लोड हो रहा है…',
} as const

export type Dictionary = typeof hi

/** The single accessor. Call sites use this rather than importing `hi`
 *  directly, so introducing a second language later is a change here alone. */
export function getDictionary(): Dictionary {
  return hi
}
