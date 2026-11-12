import { detectPostingLanguages } from './posting-language';

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

describe('detectPostingLanguages', () => {
  it('detects an English posting', () => {
    expect(detectPostingLanguages(ENGLISH)).toEqual({
      codes: ['en'],
      confident: true,
    });
  });

  it('detects a Spanish posting', () => {
    expect(detectPostingLanguages(SPANISH)).toEqual({
      codes: ['es'],
      confident: true,
    });
  });

  it('a French posting with one English line is French only', () => {
    const text = `${FRENCH}\n\nPlease apply with your resume in English or French.`;
    expect(detectPostingLanguages(text)).toEqual({
      codes: ['fr'],
      confident: true,
    });
  });

  it('a bilingual French and English posting gives both', () => {
    const text = `${FRENCH}\n\n${ENGLISH_FR}`;
    const result = detectPostingLanguages(text);
    expect(result.confident).toBe(true);
    expect([...result.codes].sort()).toEqual(['en', 'fr']);
  });

  it('a short text is not confident', () => {
    expect(
      detectPostingLanguages('Senior backend engineer, Go, remote in Europe.'),
    ).toEqual({ codes: [], confident: false });
    expect(detectPostingLanguages('')).toEqual({
      codes: [],
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
      confident: false,
    });
  });
});
