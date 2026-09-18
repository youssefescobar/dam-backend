/**
 * Guided (menu) chat — canned answers + buttons, no LLM required.
 */

export const MAIN_MENU_OPTIONS = [
  { id: 'about', label: 'About the company' },
  { id: 'hours', label: 'Business hours' },
  { id: 'airport', label: 'Airport transfers' },
  { id: 'hajj', label: 'Hajj & Umrah' },
  { id: 'workers', label: 'Worker / corporate transit' },
  { id: 'international', label: 'International routes' },
  { id: 'quote', label: 'How to get a quote' },
  { id: 'human', label: 'Talk to a human' },
  { id: 'free_text', label: 'Type my own question' },
];

/** @type {Record<string, { answer?: string, escalate?: boolean, freeText?: boolean, options?: 'main' | { id: string, label: string }[] }>} */
export const GUIDED_NODES = {
  about: {
    answer:
      'Durrah Al Munawwara Transport (شركة درة المنورة للنقل) is a Saudi transportation and logistics company established in 2014. We run Hajj & Umrah pilgrim shuttles, international bus routes, and daily worker/corporate transfers, supported by live fleet tracking.',
    options: 'main',
  },
  hours: {
    answer:
      'Customer support is typically available Saturday–Thursday, 8:00 AM–8:00 PM Saudi time (AST). During peak Hajj/Umrah seasons, operations may run extended hours.',
    options: 'main',
  },
  airport: {
    answer:
      'Yes — we provide airport and city transfers. Pricing depends on pickup/dropoff, vehicle type, and passengers. Use “How to get a quote” or type your trip details.',
    options: 'main',
  },
  hajj: {
    answer:
      'We operate large bus fleets for Hajj & Umrah, including disability-friendly vehicles, shuttling pilgrims between accommodations and the Grand Mosque in Makkah. We also partner with international Hajj missions for high-volume movement.',
    options: 'main',
  },
  workers: {
    answer:
      'Our Worker Transfer (نقل العمال) division handles daily commuting for corporate clients — moving employees between residences and job sites on scheduled routes.',
    options: 'main',
  },
  international: {
    answer:
      'We run daily long-haul international bus services connecting Saudi Arabia with regions across Yemen, using recent-model coaches.',
    options: 'main',
  },
  quote: {
    answer:
      'To get a quote, send: customer name, contact, pickup, dropoff, trip date, vehicle type, and number of passengers. You can type that here, or an admin can create it from the Quotes screen.',
    options: 'main',
  },
  human: {
    escalate: true,
  },
  free_text: {
    answer:
      'Sure — type your question below. I will search our knowledge base and answer when I can.',
    options: [],
    freeText: true,
  },
};

export function resolveGuidedOptions(spec) {
  if (spec === 'main' || spec == null) return MAIN_MENU_OPTIONS;
  if (Array.isArray(spec)) return spec;
  return MAIN_MENU_OPTIONS;
}

export function getGuidedNode(choiceId) {
  if (!choiceId) return null;
  return GUIDED_NODES[choiceId] || null;
}

export function findChoiceIdByLabel(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return null;
  const hit = MAIN_MENU_OPTIONS.find((o) => o.label.toLowerCase() === t);
  return hit?.id || null;
}

export function getWelcomePayload() {
  return {
    answer: greetingWelcome(),
    options: MAIN_MENU_OPTIONS,
    reason: 'guided_welcome',
  };
}

export function greetingWelcome() {
  return (
    "Hello! I'm the Durrah Al Munawwara guided assistant. " +
    'Pick an option below, or choose “Type my own question” to ask freely.'
  );
}
