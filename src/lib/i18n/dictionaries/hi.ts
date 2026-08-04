/**
 * Hindi UI chrome. This is the source of truth for the Dictionary shape —
 * en.ts is typed against it, so adding a key here forces a matching English
 * string and a missing translation is a type error, not a runtime `undefined`.
 *
 * Article content is NOT translated here; it lives in the database with its
 * own `language` field.
 */
export const hi = {
  siteName: 'राज चौक',
  tagline: 'खबर, विश्लेषण और आपकी राय',

  nav: {
    home: 'होम',
    latest: 'ताज़ा',
    opinion: 'राज चौक की राय',
    janmat: 'जनमत',
    ask: 'राज चौक से पूछें',
    promises: 'वादा ट्रैकर',
    live: 'लाइव',
    videos: 'वीडियो',
    about: 'हमारे बारे में',
    search: 'खोजें',
    menu: 'मेन्यू',
    closeMenu: 'मेन्यू बंद करें',
    skipToContent: 'मुख्य सामग्री पर जाएँ',
    signIn: 'साइन इन',
    signOut: 'साइन आउट',
    account: 'मेरा खाता',
    admin: 'एडमिन',
    language: 'भाषा',
    theme: 'थीम',
    themeLight: 'दिन',
    themeDark: 'रात',
    themeSystem: 'सिस्टम',
  },

  article: {
    whatHappened: 'क्या हुआ',
    importantFacts: 'ज़रूरी तथ्य',
    myAnalysis: 'विश्लेषण',
    myConclusion: 'निष्कर्ष',
    sources: 'स्रोत',
    relatedArticles: 'संबंधित खबरें',
    readingTime: '{minutes} मिनट का पठन',
    publishedOn: 'प्रकाशित',
    updatedOn: 'अपडेटेड',
    by: 'द्वारा',
    share: 'साझा करें',
    correction: 'सुधार',
    correctionHistory: 'सुधार का इतिहास',
    watchAnalysis: 'अमृत का विश्लेषण देखें',
  },

  badge: {
    verifiedFact: 'सत्यापित तथ्य',
    myAnalysis: 'विश्लेषण',
    opinion: 'राय',
    developing: 'विकसित हो रही खबर',
    correction: 'सुधार',
    sponsored: 'प्रायोजित',
  },

  poll: {
    title: 'जनमत',
    vote: 'वोट दें',
    voted: 'आपका वोट दर्ज हो गया',
    changeVote: 'वोट बदलें',
    results: 'परिणाम',
    totalVotes: 'कुल {count} वोट',
    closesOn: '{date} को बंद होगा',
    closed: 'यह जनमत बंद हो चुका है',
    selectFirst: 'पहले एक विकल्प चुनें',
    explainPrompt: 'अपने वोट का कारण बताएँ (वैकल्पिक)',
    yourChoice: 'आपका चुनाव',
    disclaimer:
      'ये परिणाम केवल राज चौक पर भाग लेने वाले पाठकों के हैं। यह वैज्ञानिक जनमत सर्वेक्षण नहीं है।',
    signInToVote: 'वोट देने के लिए साइन इन करें',
  },

  questions: {
    title: 'राज चौक से पूछें',
    ask: 'सवाल पूछें',
    upvote: 'समर्थन',
    removeUpvote: 'समर्थन हटाएँ',
    answered: 'उत्तर दिया गया',
    pending: 'समीक्षा में',
    planned: 'योजना में',
    submitted: 'आपका सवाल समीक्षा के लिए भेज दिया गया है',
    signInToAsk: 'सवाल पूछने के लिए साइन इन करें',
    empty: 'अभी कोई सवाल नहीं है। पहला सवाल आप पूछें।',
  },

  comments: {
    title: 'टिप्पणियाँ',
    label: 'आपकी टिप्पणी',
    submit: 'भेजें',
    reply: 'जवाब दें',
    report: 'रिपोर्ट करें',
    hint: 'कृपया शालीन भाषा का प्रयोग करें। सभी टिप्पणियाँ समीक्षा के बाद प्रकाशित होती हैं।',
    submitted: 'आपकी टिप्पणी समीक्षा के लिए भेज दी गई है',
    empty: 'अभी कोई टिप्पणी नहीं है।',
    signInToComment: 'टिप्पणी करने के लिए साइन इन करें',
    closed: 'इस लेख पर टिप्पणियाँ बंद हैं।',
  },

  promises: {
    title: 'वादा ट्रैकर',
    status: {
      notStarted: 'शुरू नहीं हुआ',
      inProgress: 'जारी है',
      stalled: 'रुका हुआ',
      completed: 'पूरा हुआ',
      broken: 'तोड़ा गया',
      compromised: 'आंशिक रूप से पूरा',
    },
    assessment: 'हमारा आकलन',
    evidence: 'प्रमाण',
    lastVerified: 'अंतिम जाँच',
    madeOn: 'वादा किया गया',
    deadline: 'समय सीमा',
    howWeAssess: 'हम आकलन कैसे करते हैं',
  },

  live: {
    title: 'लाइव चर्चा',
    upcoming: 'आगामी',
    liveNow: 'अभी लाइव',
    ended: 'समाप्त',
    cancelled: 'रद्द',
    register: 'रुचि दर्ज करें',
    registered: 'आपकी रुचि दर्ज हो गई',
    addToCalendar: 'कैलेंडर में जोड़ें',
    watchReplay: 'रिकॉर्डिंग देखें',
    startsAt: '{date} को शुरू',
  },

  newsletter: {
    title: 'न्यूज़लेटर',
    description: 'हर सुबह ज़रूरी खबरें और विश्लेषण, सीधे आपके इनबॉक्स में।',
    emailLabel: 'ईमेल पता',
    consent: 'मैं राज चौक से ईमेल पाने के लिए सहमत हूँ।',
    submit: 'सब्सक्राइब करें',
    // Deliberately non-committal: the backend never reveals whether an
    // address is already subscribed.
    submitted: 'यदि यह पता मान्य है, तो पुष्टिकरण ईमेल भेज दिया गया है।',
    unsubscribe: 'सदस्यता समाप्त करें',
  },

  search: {
    title: 'खोज',
    placeholder: 'खबरें, सवाल, वादे खोजें',
    submit: 'खोजें',
    resultsFor: '"{query}" के लिए परिणाम',
    resultCount: '{count} परिणाम मिले',
    noResults: 'कोई परिणाम नहीं मिला।',
    tryDifferent: 'कोई दूसरा शब्द आज़माएँ।',
  },

  common: {
    loadMore: 'और दिखाएँ',
    loading: 'लोड हो रहा है',
    retry: 'फिर से कोशिश करें',
    cancel: 'रद्द करें',
    confirm: 'पुष्टि करें',
    close: 'बंद करें',
    save: 'सहेजें',
    delete: 'हटाएँ',
    edit: 'संपादित करें',
    back: 'वापस',
    next: 'आगे',
    previous: 'पिछला',
    page: 'पृष्ठ',
    breadcrumb: 'ब्रेडक्रम्ब',
    pagination: 'पेजिनेशन',
    opensInNewWindow: '(नई विंडो में खुलता है)',
  },

  errors: {
    title: 'कुछ गड़बड़ हो गई',
    generic: 'कुछ गड़बड़ हो गई। कृपया फिर से कोशिश करें।',
    network: 'नेटवर्क से संपर्क नहीं हो पा रहा। कृपया कनेक्शन जाँचें।',
    unauthenticated: 'कृपया पहले साइन इन करें।',
    forbidden: 'आपके पास इसकी अनुमति नहीं है।',
    notFound: 'यह पृष्ठ नहीं मिला।',
    notFoundDescription: 'जो पता आपने खोला है वह मौजूद नहीं है या हटा दिया गया है।',
    rateLimited: 'बहुत सारे अनुरोध। कृपया थोड़ी देर बाद कोशिश करें।',
    validation: 'फ़ॉर्म में {count} त्रुटियाँ हैं',
    goHome: 'होम पर जाएँ',
  },

  a11y: {
    breakingNews: 'ब्रेकिंग न्यूज़',
    mainNavigation: 'मुख्य नेविगेशन',
    footerNavigation: 'फुटर नेविगेशन',
    footerSections: 'फुटर के मुख्य अनुभाग',
    footerInformation: 'फुटर की जानकारी',
    userMenu: 'उपयोगकर्ता मेन्यू',
    playVideo: 'चलाएँ: {title}',
  },
}

/**
 * The Hindi dictionary defines the shape. Note the deliberate absence of
 * `as const`: it would make every value a string *literal* type, so en.ts
 * could never satisfy `Dictionary`. Widened to `string`, this type still
 * enforces that both languages have exactly the same key set.
 */
export type Dictionary = typeof hi
