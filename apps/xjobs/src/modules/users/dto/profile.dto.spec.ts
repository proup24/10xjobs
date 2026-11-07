import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import {
  CreateProfileDto,
  POSITION_IMMUTABLE,
  ReplaceProfileDto,
} from './profile.dto';
import { LOCATIONS_REQUIRED } from 'src/modules/queries';

const options = { whitelist: true, forbidNonWhitelisted: true };

const validProfile = {
  position: 'backend_engineer',
  languages: [
    { lang: 'en', level: 'fluent' },
    { lang: 'fr', level: 'native' },
  ],
  locations: {
    remote: [
      { kind: 'region', code: 'MENA' },
      { kind: 'region', code: 'NORTH_AFRICA' },
      { kind: 'worldwide' },
    ],
    hybrid: [{ kind: 'country', code: 'MA' }],
    onsite: [{ kind: 'city', id: '0190f3c2-7a1b-7c3d-8e4f-5a6b7c8d9e0f' }],
  },
  yearsOfExperience: 6,
  timezoneCurrent: 60,
  timezoneMin: -240,
  timezoneMax: 240,
  engagements: ['employee', 'contractor'],
  seniorities: ['senior'],
  contractTypes: ['full_time', 'contract'],
  salary: { min: 4000, currency: 'EUR', period: 'month' },
  acceptsAnyCurrency: false,
  acceptedCurrencies: ['EUR', 'MAD'],
  noticePeriodDays: 30,
  techStack: [{ technology: 'nodejs', domain: 'backend', mastery: 8 }],
};

function paths(errors: ValidationError[], prefix = ''): string[] {
  return errors.flatMap((error) => {
    const path = prefix + error.property;
    return error.children?.length ? paths(error.children, `${path}.`) : [path];
  });
}

async function errorsFor(changes: object) {
  const dto = plainToInstance(CreateProfileDto, {
    ...validProfile,
    ...changes,
  });
  return paths(await validate(dto, options));
}

describe('ReplaceProfileDto', () => {
  const { position: _position, ...editable } = validProfile;

  it('accepts every editable field without a position', async () => {
    const dto = plainToInstance(ReplaceProfileDto, editable);
    expect(await validate(dto, options)).toEqual([]);
  });

  it('rejects any position, saying the profile must be recreated', async () => {
    for (const position of ['backend_engineer', 'ml_engineer']) {
      const dto = plainToInstance(ReplaceProfileDto, {
        ...editable,
        position,
      });
      const errors = await validate(dto, options);
      expect(errors.map((e) => e.property)).toEqual(['position']);
      expect(Object.values(errors[0].constraints ?? {})).toEqual([
        POSITION_IMMUTABLE,
      ]);
    }
  });
});

describe('CreateProfileDto', () => {
  it('accepts a full profile', async () => {
    expect(await errorsFor({})).toEqual([]);
  });

  it.each(['languages', 'engagements', 'contractTypes'])(
    'rejects an empty %s list',
    async (field) => {
      expect(await errorsFor({ [field]: [] })).toEqual([field]);
    },
  );

  it.each([[['backend_engineer']], [undefined], ['Backend Engineer']])(
    'requires exactly one position code, rejecting %j',
    async (position) => {
      expect(await errorsFor({ position })).toEqual(['position']);
    },
  );

  it('leaves code membership to the database: an unknown position passes', async () => {
    expect(await errorsFor({ position: 'wizard' })).toEqual([]);
  });

  it('rejects the removed country and city fields', async () => {
    expect(await errorsFor({ country: 'MA' })).toEqual(['country']);
    expect(await errorsFor({ city: 'Rabat' })).toEqual(['city']);
  });

  it.each([[['Full_Time']], [['full time']], ['full_time'], [undefined]])(
    'rejects contractTypes %j',
    async (contractTypes) => {
      expect(await errorsFor({ contractTypes })).toEqual(['contractTypes']);
    },
  );

  it('rejects a repeated contract type', async () => {
    expect(
      await errorsFor({ contractTypes: ['full_time', 'full_time'] }),
    ).toEqual(['contractTypes']);
  });

  it('rejects per-task and accepts per_task', async () => {
    expect(await errorsFor({ engagements: ['per-task'] })).toEqual([
      'engagements',
    ]);
    expect(await errorsFor({ engagements: ['per_task'] })).toEqual([]);
  });

  it('rejects a timezone range whose min is above its max', async () => {
    expect(await errorsFor({ timezoneMin: 300, timezoneMax: 240 })).toEqual([
      'timezoneMax',
    ]);
  });

  it('rejects an offset beyond UTC+14', async () => {
    expect(await errorsFor({ timezoneCurrent: 900 })).toEqual([
      'timezoneCurrent',
    ]);
  });

  it.each([{ mastery: 11 }, { mastery: -1 }, { preference: 3.5 }])(
    'rejects the skill rating %j',
    async (rating) => {
      const errors = await errorsFor({
        techStack: [{ ...validProfile.techStack[0], ...rating }],
      });
      expect(errors).toEqual([`techStack.0.${Object.keys(rating)[0]}`]);
    },
  );

  it('rejects a technology that is not a code, and passes any code on to the database', async () => {
    const skill = validProfile.techStack[0];
    expect(
      await errorsFor({ techStack: [{ ...skill, technology: 'Node.js' }] }),
    ).toEqual(['techStack.0.technology']);
    expect(
      await errorsFor({ techStack: [{ ...skill, technology: 'saas' }] }),
    ).toEqual([]);
  });

  it('rejects the same technology twice in one domain', async () => {
    const skill = validProfile.techStack[0];
    expect(await errorsFor({ techStack: [skill, { ...skill }] })).toEqual([
      'techStack',
    ]);
  });

  it('accepts the same technology in two domains', async () => {
    expect(
      await errorsFor({
        techStack: [
          {
            technology: 'typescript',
            domain: 'backend',
            mastery: 8,
          },
          {
            technology: 'typescript',
            domain: 'frontend',
            mastery: 6,
          },
        ],
      }),
    ).toEqual([]);
  });

  it('accepts an empty tech stack', async () => {
    expect(await errorsFor({ techStack: [] })).toEqual([]);
  });
});

describe('profile seniorities', () => {
  it('accepts several seniorities', async () => {
    expect(await errorsFor({ seniorities: ['senior', 'staff'] })).toEqual([]);
  });

  it.each([
    [[]],
    [['senior', 'senior']],
    [['Senior']],
    ['senior'],
    [undefined],
  ])('rejects seniorities %j', async (seniorities) => {
    expect(await errorsFor({ seniorities })).toEqual(['seniorities']);
  });

  // Membership is the database's job: the code trigger refuses these with a 400.
  it.each([[['wizard']], [['unstated']]])(
    'passes seniorities %j on to the database',
    async (seniorities) => {
      expect(await errorsFor({ seniorities })).toEqual([]);
    },
  );

  it('rejects the old single seniority field', async () => {
    expect(await errorsFor({ seniority: 'senior' })).toEqual(['seniority']);
  });
});

describe('profile locations', () => {
  const none = { remote: [], hybrid: [], onsite: [] };
  const city = { kind: 'city', id: '0190f3c2-7a1b-7c3d-8e4f-5a6b7c8d9e0f' };

  async function messagesFor(changes: object) {
    const dto = plainToInstance(CreateProfileDto, {
      ...validProfile,
      ...changes,
    });
    const flatten = (errors: ValidationError[]): string[] =>
      errors.flatMap((error) => [
        ...Object.values(error.constraints ?? {}),
        ...flatten(error.children ?? []),
      ]);
    return flatten(await validate(dto, options));
  }

  it('accepts places in a single arrangement', async () => {
    expect(
      await errorsFor({
        locations: { ...none, remote: [{ kind: 'worldwide' }] },
      }),
    ).toEqual([]);
  });

  it('rejects a profile with no place, saying why', async () => {
    expect(await errorsFor({ locations: none })).toEqual(['locations']);
    expect(await messagesFor({ locations: none })).toContain(
      LOCATIONS_REQUIRED,
    );
  });

  it('requires locations', async () => {
    expect(await errorsFor({ locations: undefined })).toEqual(['locations']);
  });

  it('requires every arrangement list', async () => {
    expect(
      await errorsFor({
        locations: { remote: [{ kind: 'worldwide' }], hybrid: [] },
      }),
    ).toEqual(['locations.onsite']);
  });

  it('rejects an unknown arrangement key', async () => {
    expect(
      await errorsFor({
        locations: { ...none, remote: [{ kind: 'worldwide' }], anywhere: [] },
      }),
    ).toEqual(['locations.anywhere']);
  });

  it.each([
    ['an unknown kind', [{ kind: 'planet', code: 'x' }]],
    ['location text', ['Paris, France']],
    ['a lowercase country code', [{ kind: 'country', code: 'ma' }]],
    ['a three-letter country code', [{ kind: 'country', code: 'MAR' }]],
    ['a lowercase region code', [{ kind: 'region', code: 'emea' }]],
    ['a city by code', [{ kind: 'city', code: 'rabat' }]],
    ['a city id that is not a uuid', [{ kind: 'city', id: 'rabat' }]],
    ['worldwide with a code', [{ kind: 'worldwide', code: 'GLOBAL' }]],
    ['an extra key', [{ kind: 'country', code: 'MA', label: 'Morocco' }]],
    ['the same place twice', [city, { ...city }]],
    [
      'more than 20 places',
      Array.from({ length: 21 }, (_, i) => ({
        kind: 'country',
        code: `A${String.fromCharCode(65 + i)}`,
      })),
    ],
  ])('rejects %s', async (_name, remote) => {
    expect(await errorsFor({ locations: { ...none, remote } })).toEqual([
      'locations.remote',
    ]);
  });

  it('accepts 20 places in one arrangement', async () => {
    const remote = Array.from({ length: 20 }, (_, i) => ({
      kind: 'country',
      code: `A${String.fromCharCode(65 + i)}`,
    }));
    expect(await errorsFor({ locations: { ...none, remote } })).toEqual([]);
  });

  it.each([
    ['arrangements', ['remote']],
    ['regions', ['EMEA']],
    ['places', none],
  ])('rejects the removed or internal %s field', async (field, value) => {
    expect(await errorsFor({ [field]: value })).toEqual([field]);
  });

  it('applies to replacements too', async () => {
    const dto = plainToInstance(ReplaceProfileDto, {
      ...validProfile,
      position: undefined,
      locations: none,
    });
    expect(paths(await validate(dto, options))).toEqual(['locations']);
  });
});

describe('profile languages', () => {
  it.each([
    ['an uppercase code', [{ lang: 'EN', level: 'fluent' }]],
    ['a three-letter code', [{ lang: 'eng', level: 'fluent' }]],
    ['an unknown level', [{ lang: 'en', level: 'basic' }]],
    ['a missing level', [{ lang: 'en' }]],
    ['a bare code', ['en']],
    [
      'the same language twice',
      [
        { lang: 'en', level: 'fluent' },
        { lang: 'en', level: 'native' },
      ],
    ],
  ])('rejects %s', async (_name, languages) => {
    const errors = await errorsFor({ languages });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((path) => path.startsWith('languages'))).toBe(true);
  });

  it.each(['native', 'fluent', 'working'])(
    'accepts the level %s',
    async (level) => {
      expect(await errorsFor({ languages: [{ lang: 'en', level }] })).toEqual(
        [],
      );
    },
  );

  it('leaves code membership to the database: an unknown language passes', async () => {
    expect(
      await errorsFor({ languages: [{ lang: 'xx', level: 'fluent' }] }),
    ).toEqual([]);
  });
});

describe('profile salary and currencies', () => {
  it.each([[null], [undefined]])('accepts no salary (%j)', async (salary) => {
    expect(await errorsFor({ salary })).toEqual([]);
  });

  it.each([
    ['a minimum of 0', { min: 0, currency: 'EUR', period: 'month' }],
    ['a fractional minimum', { min: 10.5, currency: 'EUR', period: 'hour' }],
    ['a lowercase currency', { min: 10, currency: 'eur', period: 'hour' }],
    ['an unknown period', { min: 10, currency: 'EUR', period: 'week' }],
    ['a missing currency', { min: 10, period: 'hour' }],
  ])('rejects a salary with %s', async (_name, salary) => {
    const errors = await errorsFor({ salary });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((path) => path.startsWith('salary'))).toBe(true);
  });

  it.each(['hour', 'day', 'month', 'year'])(
    'accepts the period %s',
    async (period) => {
      expect(
        await errorsFor({ salary: { min: 1, currency: 'EUR', period } }),
      ).toEqual([]);
    },
  );

  it('accepts any currency with an empty list', async () => {
    expect(
      await errorsFor({ acceptsAnyCurrency: true, acceptedCurrencies: [] }),
    ).toEqual([]);
  });

  it.each([
    ['acceptsAnyCurrency', 'yes'],
    ['acceptsAnyCurrency', undefined],
    ['acceptedCurrencies', ['eur']],
    ['acceptedCurrencies', ['EUR', 'EUR']],
    ['acceptedCurrencies', undefined],
  ])('rejects %s %j', async (field, value) => {
    expect(await errorsFor({ [field]: value })).toEqual([field]);
  });
});
