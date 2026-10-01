import { describe, it, expect } from '@jest/globals';
import { normalizeArabic, selectRelevantEntries, tokenize } from '../../src/services/faqPrompt.js';
import { buildContents, classifyChitchat, isExplicitHumanRequest, looksLikeEscalate } from '../../src/services/llm.js';
import { detectIntent, detectLang } from '../../src/config/guidedChat.js';

const entry = (id, title, content, extra = {}) => ({
  id,
  title,
  content,
  intent: '',
  category: '',
  locale: 'en',
  escalate: false,
  ...extra,
});

describe('Arabic-aware retrieval', () => {
  it('folds spelling variants and strips the article', () => {
    expect(normalizeArabic('الرحلـة أإآ ى ة')).toBe('الرحله ااا ي ه');
    expect(tokenize('الرحلات الدولية')).toEqual(tokenize('رحلات دوليه'));
  });

  it('selects the rows that match the question, in either language', () => {
    const many = Array.from({ length: 60 }, (_, i) => entry(`f${i}`, `Filler topic ${i}`, `Unrelated text ${i}`));
    many.push(entry('hajj', 'ما هي خدمات الحج والعمرة؟', 'ننقل الحجاج بين المطارات ومكة والمدينة', { locale: 'ar' }));
    many.push(entry('lost', 'What if I lose my luggage?', 'Report it with your trip number.'));

    const ar = selectRelevantEntries(many, 'هل تقدمون نقل الحجاج؟', { lang: 'ar', max: 10 });
    expect(ar.some((e) => e.id === 'hajj')).toBe(true);
    expect(ar.length).toBeLessThanOrEqual(15);

    const en = selectRelevantEntries(many, 'my luggage is gone', { lang: 'en', max: 10 });
    expect(en[0].id).toBe('lost');
  });

  it('keeps escalate rows and still returns context for vague questions', () => {
    const many = Array.from({ length: 50 }, (_, i) => entry(`f${i}`, `Topic ${i}`, `Body ${i}`));
    many.push(entry('esc', 'Accident report', 'Escalate immediately', { escalate: true }));
    const picked = selectRelevantEntries(many, 'hmm', { max: 10 });
    expect(picked.length).toBeGreaterThanOrEqual(10);
    const picked2 = selectRelevantEntries(many, 'topic 3', { max: 5 });
    expect(picked2.some((e) => e.id === 'esc')).toBe(true);
  });

  it('returns everything when the KB is small', () => {
    const few = [entry('a', 'A', 'a'), entry('b', 'B', 'b')];
    expect(selectRelevantEntries(few, 'anything', { max: 30 })).toHaveLength(2);
  });
});

describe('conversation memory for the model', () => {
  it('alternates roles, starts with the user, and does not repeat the question', () => {
    const history = [
      { role: 'assistant', text: 'Welcome' },
      { role: 'user', text: 'Do you go to Madinah?' },
      { role: 'assistant', text: 'Yes, daily.' },
      { role: 'user', text: 'And Makkah?' },
    ];
    const contents = buildContents(history, 'And Makkah?');
    expect(contents.map((c) => c.role)).toEqual(['user', 'model', 'user']);
    expect(contents[2].parts[0].text).toBe('And Makkah?');
  });

  it('appends the question when history does not end with it', () => {
    const contents = buildContents([{ role: 'assistant', text: 'Hi' }], 'Price?');
    expect(contents).toEqual([{ role: 'user', parts: [{ text: 'Price?' }] }]);
  });
});

describe('language + intent helpers', () => {
  it('detects language by script', () => {
    expect(detectLang('مرحبا')).toBe('ar');
    expect(detectLang('hello')).toBe('en');
    expect(detectLang('12345 ?!')).toBeNull();
  });

  it('classifies chit-chat in both languages', () => {
    expect(classifyChitchat('السلام عليكم')).toBe('hello');
    expect(classifyChitchat('Thanks!')).toBe('thanks');
    expect(classifyChitchat('مع السلامة')).toBe('bye');
    expect(classifyChitchat('how much is a ticket')).toBeNull();
  });

  it('recognises Arabic requests for a person', () => {
    expect(isExplicitHumanRequest('ابغى اكلم موظف')).toBe(true);
    expect(isExplicitHumanRequest('Can I speak to a real person?')).toBe(true);
    expect(isExplicitHumanRequest('كم سعر التذكرة')).toBe(false);
  });

  it('keeps price questions for the knowledge base but shortcuts explicit quote asks', () => {
    expect(detectIntent('how much is an airport transfer?')).toBeNull();
    expect(detectIntent('I need a quote')).toBe('quote');
    expect(detectIntent('أبي عرض سعر')).toBe('quote');
    expect(detectIntent('what are your working hours')).toBe('hours');
  });

  it('does not treat ordinary Arabic booking messages as a request for staff', () => {
    expect(isExplicitHumanRequest('أريد حافلة تتسع 50 شخص')).toBe(false);
    expect(isExplicitHumanRequest('ممكن باص لـ 40 شخص؟')).toBe(false);
    expect(isExplicitHumanRequest('نحتاج نقل لـ 30 شخص من المطار')).toBe(false);
    expect(isExplicitHumanRequest('أريد التحدث مع موظف')).toBe(true);
    expect(isExplicitHumanRequest('أبغى موظف')).toBe(true);
    expect(isExplicitHumanRequest('حولني لخدمة العملاء')).toBe(true);
    expect(isExplicitHumanRequest('I need to speak to a manager')).toBe(true);
  });

  it('only starts a lost-item or complaint form for clear requests', () => {
    expect(detectIntent('I left my bag on the bus')).toBe('lost_found');
    expect(detectIntent('نسيت حقيبتي في الحافلة')).toBe('lost_found');
    expect(detectIntent('I left my phone number in the form')).toBeNull();
    expect(detectIntent('نسيت أن أسأل عن شيء')).toBeNull();
    expect(detectIntent('I want to make a complaint')).toBe('complaint');
    expect(detectIntent('the ride was terrible but the driver was nice')).toBeNull();
  });

  it('recognises the model hand-over sentinel', () => {
    expect(looksLikeEscalate('ESCALATE')).toBe(true);
    expect(looksLikeEscalate('  escalate.')).toBe(true);
    expect(looksLikeEscalate("I don't know")).toBe(false);
    expect(looksLikeEscalate('We do not escalate fares')).toBe(false);
  });
});
