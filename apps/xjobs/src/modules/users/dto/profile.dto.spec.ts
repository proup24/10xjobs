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
  languages: ['EN', 'FR'],
  country: 'MA',
  city: 'Rabat',
  locations: {
    remote: ['MENA', 'North Africa', 'EMEA'],
    hybrid: [],
    onsite: [],
  },
  yearsOfExperience: 6,
  timezoneCurrent: 60,
  timezoneMin: -240,
  timezoneMax: 240,
  engagements: ['employee', 'contractor'],
  seniorities: ['senior'],
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

  it.each(['languages', 'engagements'])(
    'rejects an empty %s list',
    async (field) => {
      expect(await errorsFor({ [field]: [] })).toEqual([field]);
    },
  );

  it.each([[['backend_engineer']], [undefined], ['wizard']])(
    'requires exactly one known position, rejecting %j',
    async (position) => {
      expect(await errorsFor({ position })).toEqual(['position']);
    },
  );

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
    [['wizard']],
    ['senior'],
    [undefined],
  ])('rejects seniorities %j', async (seniorities) => {
    expect(await errorsFor({ seniorities })).toEqual(['seniorities']);
  });

  it('rejects the old single seniority field', async () => {
    expect(await errorsFor({ seniority: 'senior' })).toEqual(['seniority']);
  });
});

describe('profile locations', () => {
  const none = { remote: [], hybrid: [], onsite: [] };

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

  it('accepts locations in a single arrangement', async () => {
    expect(
      await errorsFor({ locations: { ...none, remote: ['Europe'] } }),
    ).toEqual([]);
  });

  it('rejects a profile with no location, saying why', async () => {
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
      await errorsFor({ locations: { remote: ['Europe'], hybrid: [] } }),
    ).toEqual(['locations.onsite']);
  });

  it('rejects an unknown arrangement key', async () => {
    expect(
      await errorsFor({
        locations: { ...none, remote: ['Europe'], anywhere: [] },
      }),
    ).toEqual(['locations.anywhere']);
  });

  it.each([
    ['a non-string', [42]],
    ['a blank entry', ['   ']],
    ['an entry over 100 characters', ['x'.repeat(101)]],
    ['more than 20 entries', Array.from({ length: 21 }, (_, i) => `City ${i}`)],
  ])('rejects %s', async (_name, onsite) => {
    expect(await errorsFor({ locations: { ...none, onsite } })).toEqual([
      'locations.onsite',
    ]);
  });

  it('accepts 20 entries of 100 characters', async () => {
    const onsite = Array.from({ length: 20 }, (_, i) =>
      `${i}`.padEnd(100, 'x'),
    );
    expect(await errorsFor({ locations: { ...none, onsite } })).toEqual([]);
  });

  it.each([
    ['arrangements', ['remote']],
    ['regions', ['EMEA']],
  ])('rejects the removed %s field', async (field, value) => {
    expect(await errorsFor({ [field]: value })).toEqual([field]);
  });

  it('accepts onsite with no city', async () => {
    expect(
      await errorsFor({
        locations: { ...none, onsite: ['Paris, France'] },
        city: null,
      }),
    ).toEqual([]);
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
