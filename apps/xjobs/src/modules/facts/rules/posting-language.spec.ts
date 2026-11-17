import { htmlToPlainText } from '../../ingest/normalize/text';
import { detectPostingLanguages, sentencePieces } from './posting-language';
import {
  CLEAN,
  LESVEXA_HTML,
  LESVEXA_STORED,
} from './posting-language.fixtures.testing';

const ENGLISH = [
  'We are looking for a senior backend engineer to join our payments team. You will design and build the services that move money between our customers and their banks.',
  'You have at least five years of experience with Go or Python, you care about reliability, and you enjoy working closely with product managers and designers.',
  'We offer a competitive salary, flexible hours, a yearly learning budget and the option to work from home most of the week.',
].join('\n\n');

const SPANISH = [
  'Buscamos un ingeniero de backend con experiencia para unirse a nuestro equipo de pagos. Diseñarás y construirás los servicios que conectan a nuestros clientes con sus bancos.',
  'Tienes al menos cinco años de experiencia con Go o Python, te importa la fiabilidad y disfrutas trabajando de cerca con el equipo de producto.',
  'Ofrecemos un salario competitivo, horario flexible, un presupuesto anual para formación y la posibilidad de trabajar desde casa.',
].join('\n\n');

const FRENCH = [
  'Nous recherchons un ingénieur backend expérimenté pour rejoindre notre équipe paiements. Vous concevrez et développerez les services qui relient nos clients à leurs banques.',
  "Vous avez au moins cinq ans d'expérience avec Go ou Python, la fiabilité vous tient à cœur et vous aimez travailler avec les équipes produit et design.",
  'Nous offrons un salaire compétitif, des horaires flexibles, un budget formation annuel et la possibilité de télétravailler la plupart de la semaine.',
].join('\n\n');

const ENGLISH_FR = [
  'We are a fast-growing fintech based in Paris, building the payment infrastructure for small businesses across Europe.',
  'You will own the services that move money between our customers and their banks, and you will work closely with our product team.',
].join('\n\n');

const PORTUGUESE = [
  'Estamos à procura de um engenheiro de backend com experiência para integrar a nossa equipa de pagamentos em Lisboa. Vais desenhar e construir os serviços que ligam os nossos clientes aos seus bancos.',
  'Tens pelo menos cinco anos de experiência com Go ou Python, preocupas-te com a fiabilidade e gostas de trabalhar de perto com a equipa de produto.',
  'Oferecemos um salário competitivo, horário flexível, um orçamento anual para formação e a possibilidade de trabalhar a partir de casa.',
].join('\n\n');

/** Scored close to Galician by franc. */
const PORTUGUESE_SHORT = [
  'Procuramos um engenheiro de backend para integrar a nossa equipa de pagamentos. Vais desenhar e construir os serviços que ligam os nossos clientes aos seus bancos.',
  'Tens pelo menos cinco anos de experiência com Go ou Python e gostas de trabalhar com a equipa de produto.',
  'Oferecemos um salário competitivo, horário flexível e a possibilidade de trabalhar a partir de casa.',
].join('\n\n');

/** French and English sentences alternating in one paragraph. */
const ALTERNATING =
  'Nous recherchons un développeur backend senior. We are looking for a senior backend developer. Vous travaillerez sur notre plateforme de paiement en Java. You will work on our payment platform in Java. Nous offrons un salaire attractif et du télétravail. We offer an attractive salary and remote work options.';

describe('detectPostingLanguages', () => {
  it('detects an English posting', () => {
    expect(detectPostingLanguages(ENGLISH)).toEqual({
      codes: ['en'],
      closeCalls: [],
      confident: true,
    });
  });

  it('detects a Spanish posting', () => {
    expect(detectPostingLanguages(SPANISH)).toEqual({
      codes: ['es'],
      closeCalls: [],
      confident: true,
    });
  });

  it('a French posting with one English line is French only', () => {
    const text = `${FRENCH}\n\nPlease apply with your resume in English or French.`;
    expect(detectPostingLanguages(text)).toEqual({
      codes: ['fr'],
      closeCalls: [],
      confident: true,
    });
  });

  it('a bilingual French and English posting gives both', () => {
    const text = `${FRENCH}\n\n${ENGLISH_FR}`;
    const result = detectPostingLanguages(text);
    expect(result.confident).toBe(true);
    expect([...result.codes].sort()).toEqual(['en', 'fr']);
  });

  it('a paragraph alternating French and English never gives another language', () => {
    expect(ALTERNATING.length).toBeGreaterThan(200);
    const r = detectPostingLanguages(ALTERNATING);
    expect(r.codes.every((c) => c === 'fr' || c === 'en')).toBe(true);
    expect(r.closeCalls).toEqual([]);
  });

  it('a Portuguese posting is Portuguese, never Galician', () => {
    expect(detectPostingLanguages(PORTUGUESE)).toEqual({
      codes: ['pt'],
      closeCalls: [],
      confident: true,
    });
    expect(detectPostingLanguages(PORTUGUESE_SHORT).codes).not.toContain('gl');
  });

  it('a short text is not confident', () => {
    expect(
      detectPostingLanguages('Senior backend engineer, Go, remote in Europe.'),
    ).toEqual({ codes: [], closeCalls: [], confident: false });
    expect(detectPostingLanguages('')).toEqual({
      codes: [],
      closeCalls: [],
      confident: false,
    });
  });

  it('a text with no detectable paragraph is not confident', () => {
    const text = Array.from(
      { length: 20 },
      (_, i) => `- Go ${i}, Kafka, gRPC`,
    ).join('\n');
    expect(text.length).toBeGreaterThan(200);
    expect(detectPostingLanguages(text)).toEqual({
      codes: [],
      closeCalls: [],
      confident: false,
    });
  });

  it('Lesvexa as stored is Spanish', () => {
    expect(detectPostingLanguages(LESVEXA_STORED)).toEqual({
      codes: ['es'],
      closeCalls: [],
      confident: true,
    });
  });

  it('Lesvexa with its breaks restored is Spanish', () => {
    expect(detectPostingLanguages(htmlToPlainText(LESVEXA_HTML))).toEqual({
      codes: ['es'],
      closeCalls: [],
      confident: true,
    });
  });

  it.each([
    ['es', 'es'],
    ['pt_pt', 'pt'],
    ['pt_br', 'pt'],
    ['it', 'it'],
    ['ro', 'ro'],
    ['fr', 'fr'],
    ['pl', 'pl'],
    ['sv', 'sv'],
    ['de', 'de'],
    ['en', 'en'],
  ] as const)(
    'a clean %s posting in a clearly separated language is sure',
    (key, code) => {
      expect(detectPostingLanguages(CLEAN[key])).toEqual({
        codes: [code],
        closeCalls: [],
        confident: true,
      });
    },
  );

  it.each(Object.keys(CLEAN) as (keyof typeof CLEAN)[])(
    'a clean %s posting is never surely another language',
    (key) => {
      const L = key.slice(0, 2);
      const r = detectPostingLanguages(CLEAN[key]);
      expect(r.confident).toBe(true);
      expect(r.codes.every((c) => c === L)).toBe(true);
      expect(r.closeCalls.every((s) => s.includes(L))).toBe(true);
      expect(r.codes.length + r.closeCalls.length).toBeGreaterThan(0);
    },
  );

  it('Malay and Croatian are always a close call of their whole group', () => {
    expect(detectPostingLanguages(CLEAN.ms)).toEqual({
      codes: [],
      closeCalls: [['id', 'ms']],
      confident: true,
    });
    expect(detectPostingLanguages(CLEAN.id)).toEqual({
      codes: [],
      closeCalls: [['id', 'ms']],
      confident: true,
    });
    expect(detectPostingLanguages(CLEAN.hr)).toEqual({
      codes: [],
      closeCalls: [['bs', 'hr', 'sr']],
      confident: true,
    });
  });

  it('splits flattened sentences but not Next.js', () => {
    const text = [
      'Buscamos un desarrollador con experiencia en Next.js y 2.5 años trabajando en productos reales.',
      'Trabajarás de cerca con el equipo de producto para decidir qué construimos cada semana.',
      'Ofrecemos un salario competitivo, horario flexible y formación continua para todo el equipo.',
      'También ofrecemos la posibilidad de trabajar desde casa varios días a la semana.',
    ].join('');
    expect(sentencePieces(text)).toHaveLength(4);
    expect(detectPostingLanguages(text)).toEqual({
      codes: ['es'],
      closeCalls: [],
      confident: true,
    });
  });

  it('a runner-up with the same ISO code is the same language', () => {
    const text =
      'ما به دنبال یک مهندس نرم افزار با تجربه برای پیوستن به تیم پشتیبان خود هستیم. شما مسئول طراحی و نگهداری سرویس هایی خواهید بود که هر روز هزاران مشتری از آن ها استفاده می کنند. ما حقوق مناسب و ساعت کاری انعطاف پذیر ارائه می دهیم و امکان کار از خانه را فراهم می کنیم.';
    expect(detectPostingLanguages(text).codes).toEqual(['fa']);
  });
});
