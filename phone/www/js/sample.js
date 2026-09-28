/* A small made-up class and passages, so the app can be tried before the
   real file from the desktop app arrives. Not DepEd material. */
window.SAMPLE_PACK = {
  app: 'phil-iri-recorder', kind: 'phone', version: 1, sample: true,
  school: { name: 'Sample School', id: '' }, sy: '2026-2027',
  rules: { word: { indep: 97, inst: 90 }, comp: { indep: 80, inst: 59 } }, combine: 'lower',
  classes: [{
    id: 'sample-c1', grade: '4', section: 'Sampaguita', adviser: 'Sample Teacher',
    learners: [
      { id: 'sample-l1', name: 'ABAD, Carlo M.', sex: 'M' }, { id: 'sample-l2', name: 'CASTILLO, Mark D.', sex: 'M' },
      { id: 'sample-l3', name: 'GARCIA, Miguel T.', sex: 'M' }, { id: 'sample-l4', name: 'BAUTISTA, Liza R.', sex: 'F' },
      { id: 'sample-l5', name: 'DELA CRUZ, Angela P.', sex: 'F' }, { id: 'sample-l6', name: 'FERNANDEZ, Kristine G.', sex: 'F' },
    ],
  }],
  passages: [
    {
      id: 'sample-p1', language: 'English', grade: '4', set: 'A', type: 'oral', title: 'The Lost Puppy',
      text: 'Mia found a small puppy near the gate. It was wet and hungry, so she gave it some warm milk and a soft towel. The next day, she put up signs around the town so the owner could find it.\n\nIn the afternoon, a boy knocked on the door. He smiled when he saw the puppy wagging its tail.',
      questions: [
        { id: 'sq1', number: 1, type: 'Literal', text: 'Where did Mia find the puppy?', choices: [], answer: null, expected: 'Near the gate.' },
        { id: 'sq2', number: 2, type: 'Literal', text: 'What did Mia give the puppy?', choices: [], answer: null, expected: 'Warm milk and a soft towel.' },
        { id: 'sq3', number: 3, type: 'Inferential', text: 'Why did Mia put up signs around the town?', choices: [], answer: null, expected: 'So the owner could find the puppy.' },
        { id: 'sq4', number: 4, type: 'Inferential', text: 'Who was the boy at the door?', choices: ['A friend of Mia', 'The owner of the puppy', 'A new neighbour'], answer: 1, expected: '' },
        { id: 'sq5', number: 5, type: 'Critical', text: 'Was Mia kind? Why do you say so?', choices: [], answer: null, expected: 'Yes, she helped the puppy.' },
      ],
    },
    {
      id: 'sample-p2', language: 'Filipino', grade: '4', set: 'A', type: 'oral', title: 'Ang Batang Masipag',
      text: 'Si Lito ay isang batang masipag. Tuwing umaga, tinutulungan niya ang kanyang ina sa paglilinis ng bahay. Pagkatapos, naghahanda siya para pumasok sa paaralan.\n\nSa paaralan, nakikinig siyang mabuti sa kanyang guro. Siya ay mag-aaral na laging handa sa klase.',
      questions: [
        { id: 'sq6', number: 1, type: 'Literal', text: 'Sino ang batang masipag?', choices: [], answer: null, expected: 'Si Lito.' },
        { id: 'sq7', number: 2, type: 'Literal', text: 'Ano ang ginagawa ni Lito tuwing umaga?', choices: [], answer: null, expected: 'Tinutulungan ang ina sa paglilinis ng bahay.' },
        { id: 'sq8', number: 3, type: 'Inferential', text: 'Bakit laging handa si Lito sa klase?', choices: ['Dahil nakikinig siyang mabuti', 'Dahil malapit ang bahay nila', 'Dahil wala siyang kaibigan'], answer: 0, expected: '' },
      ],
    },
    {
      id: 'sample-p3', language: 'English', grade: '4', set: 'A', type: 'gst', title: 'Screening: At the Market',
      text: 'Ben and his father went to the market early in the morning. They bought fish, rice and some bananas. Ben carried the basket because his father was holding an umbrella. It started to rain on the way home.',
      questions: [
        { id: 'sg1', number: 1, type: 'Literal', text: 'When did Ben and his father go to the market?', choices: ['At night', 'Early in the morning', 'At noon', 'After school'], answer: 1 },
        { id: 'sg2', number: 2, type: 'Literal', text: 'What did they NOT buy?', choices: ['Fish', 'Rice', 'Bread', 'Bananas'], answer: 2 },
        { id: 'sg3', number: 3, type: 'Literal', text: 'Who carried the basket?', choices: ['Ben', 'His father', 'His mother', 'A vendor'], answer: 0 },
        { id: 'sg4', number: 4, type: 'Inferential', text: 'Why did the father hold an umbrella?', choices: ['It was sunny', 'It was going to rain', 'He was tired', 'It was a gift'], answer: 1 },
        { id: 'sg5', number: 5, type: 'Critical', text: 'What kind of son is Ben?', choices: ['Lazy', 'Helpful', 'Angry', 'Shy'], answer: 1 },
      ],
    },
  ],
};
