import { DROP_RULES, firstDrop, type RuleInput } from './rules';

const rule = (name: string) => {
  const r = DROP_RULES.find((x) => x.name === name);
  if (!r) throw new Error(`no rule ${name}`);
  return r;
};
const input = (over: Partial<RuleInput>): RuleInput => ({
  text: '',
  headline: null,
  openToWorkCard: false,
  ...over,
});

// Excerpts are cleaned text (no emoji or hashtag marks) from the labelled
// sample; `#n` is the entry's index in `sample/sample.json`.
describe('open-to-work', () => {
  const match = (over: Partial<RuleInput>) =>
    rule('open-to-work').match(input(over));

  it('matches the open-to-work card (#69, #144)', () => {
    expect(
      match({
        openToWorkCard: true,
        text: "Hi connections\nI'm a Full Stack Developer with 2.8+ years of experience, currently looking for my next opportunity.",
      }),
    ).toBe('open-to-work card');
  });

  it.each([
    // #4
    [
      'OPEN TO WORK | SEEKING FULL-TIME REMOTE OPPORTUNITIES\nHello, LinkedIn community!',
      'OPEN TO WORK',
    ],
    // #12: the hashtag, cleaned to a bare word
    [
      'OpenToWork | Senior Full Stack .NET Developer | C2C / 1099 Opportunities',
      'OpenToWork',
    ],
    // #53
    [
      'Yeni Kariyer Fırsatlarına Açığım! | Open to Work\nMerhaba LinkedIn ağım',
      'Open to Work',
    ],
    ['Open-to-work: senior React developer, available now', 'Open-to-work'],
    // #103: mathematical bold letters
    ['𝐎𝐏𝐄𝐍 𝐓𝐎 𝐖𝐎𝐑𝐊 | 𝐒𝐫. 𝐏𝐇𝐏 / 𝐋𝐀𝐑𝐀𝐕𝐄𝐋 𝐃𝐄𝐕𝐄𝐋𝐎𝐏𝐄𝐑', 'OPEN TO WORK'],
  ])('matches "open to work" early in the text: %s', (text, words) => {
    expect(match({ text })).toBe(words);
  });

  it.each([
    // #14
    'Java Developer | Spring Boot | REST APIs | SQL | JWT | B.Tech CSE 2026 | Open to Work',
    // #55
    'Développeur Full-Stack | Stack MERN | OPENTOWORK',
    // #103
    'OpenToWork | Immediate Joiner | Sr. Laravel Developer | PHP',
  ])('matches "open to work" in the headline: %s', (headline) => {
    expect(match({ headline, text: 'Bonjour à tous' })).not.toBeNull();
  });

  it('does not match a hiring post with the hashtag late in the text (#71, #115, #130)', () => {
    const text =
      "Hiring SoftwareEngineer Oakspiretek\n\nHere are today's Full Stack Software Engineer Requirements. " +
      'Apply on the links below. '.repeat(10) +
      'OpenToWork jobs remotejobs';
    expect(text.indexOf('OpenToWork')).toBeGreaterThan(200);
    expect(match({ text, headline: '473 followers' })).toBeNull();
  });

  it('does not match a hiring post that leads with hashtags, open to work among them', () => {
    expect(
      match({
        text: 'Newrequirement Hiring OpenToWork\nExp: 9+ years\nContract: W2 only',
      }),
    ).toBeNull();
  });

  it('does not match "open to" other things', () => {
    expect(
      match({
        text: 'We are hiring a Senior Engineer, open to relocation, open to working remotely',
        headline: 'Talent Partner | Open to connect',
      }),
    ).toBeNull();
  });
});

describe('bench-sales-hotlist', () => {
  const match = (text: string) =>
    rule('bench-sales-hotlist').match(input({ text }));

  it.each([
    // #56
    'HOTLIST – AVAILABLE IT CONSULTANTS | READY FOR IMMEDIATE OPPORTUNITIES\nPlease find our latest consultant hotlist below.\nAVAILABLE CONSULTANTS:\n1 Kalyan – QA Engineer | 12 Years | H1B',
    // #60
    'HOTLIST ALERT | IMMEDIATE AVAILABILITY | IT PROFESSIONALS\nWe are pleased to share our latest IT Consultants Hotlist\nAvailable IT Consultants:\nForward Deployed Engineer (FDE) – 9+ Years',
  ])('matches a hotlist headed "Available consultants:" (%#)', (text) => {
    expect(match(text)).toMatch(/^available (it )?consultants:$/i);
  });

  it.each([
    // the hashtags of 22 hiring posts, e.g. #0, #115
    'Role: IT Technical Support\nSend resumes to careers@example.com\nc2crequirements c2chotlist benchsales availableconsultants hotlist',
    'Please share your available consultants for this requirement: Java Developer, Dallas TX',
    'We need consultants available immediately: Network Engineer, remote',
  ])('does not match a hiring post: %s', (text) => {
    expect(match(text)).toBeNull();
  });
});

describe('DROP_RULES', () => {
  it('ships only the rules the labelled sample supports', () => {
    expect(DROP_RULES.map((r) => r.name)).toEqual([
      'open-to-work',
      'bench-sales-hotlist',
    ]);
  });

  it('reports the first rule and its match', () => {
    expect(firstDrop(input({ text: 'Open to Work | Java developer' }))).toEqual(
      { rule: 'open-to-work', match: 'Open to Work' },
    );
    expect(
      firstDrop(input({ text: 'We are hiring a Java developer' })),
    ).toBeNull();
  });
});
