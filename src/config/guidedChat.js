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
      'We’re Durrah Al Munawwara Transport — Saudi logistics since 2014. Hajj & Umrah shuttles, international buses, and daily worker transfers with live fleet tracking.',
    options: 'main',
  },
  hours: {
    answer:
      'We’re usually here Saturday–Thursday, 8 AM–8 PM Saudi time. Peak Hajj/Umrah seasons may run longer hours.',
    options: 'main',
  },
  airport: {
    answer:
      'Yes — airport and city transfers are available. Price depends on route, vehicle, and passengers. Tap “How to get a quote” or share your trip details.',
    options: 'main',
  },
  hajj: {
    answer:
      'We run large Hajj & Umrah fleets (including accessible buses) between hotels and the Grand Mosque, and partner with international missions for big groups.',
    options: 'main',
  },
  workers: {
    answer:
      'Our Worker Transfer team moves employees daily between homes and job sites on scheduled corporate routes.',
    options: 'main',
  },
  international: {
    answer:
      'We operate daily long-haul coaches linking Saudi Arabia with regions across Yemen.',
    options: 'main',
  },
  quote: {
    answer:
      'Happy to quote you — send name, contact, pickup, dropoff, date, vehicle type, and passenger count.',
    options: 'main',
  },
  human: {
    escalate: true,
  },
  free_text: {
    answer: 'Of course — type your question below and I’ll do my best to help.',
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
  return "Hi! Welcome to Durrah Al Munawwara. Pick a topic below, or type your own question anytime.";
}
