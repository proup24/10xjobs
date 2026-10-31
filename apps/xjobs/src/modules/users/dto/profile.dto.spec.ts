import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import {
  CreateProfileDto,
  POSITION_IMMUTABLE,
  ReplaceProfileDto,
} from './profile.dto';
import { CITY_REQUIRED } from 'src/modules/queries';

const options = { whitelist: true, forbidNonWhitelisted: true };

const validProfile = {
  position: 'backend_engineer',
  languages: ['EN', 'FR'],
  country: 'MA',
  city: 'Rabat',
  regions: ['MENA', 'NORTH_AFRICA', 'EMEA'],
  yearsOfExperience: 6,
  timezoneCurrent: 60,
  timezoneMin: -240,
  timezoneMax: 240,
  engagements: ['employee', 'contractor'],
  arrangements: ['remote'],
  seniority: 'senior',
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

  it.each(['languages', 'engagements', 'arrangements'])(
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

describe('profile city rule', () => {
  it.each([
    [{ arrangements: ['onsite'], city: null }],
    [{ arrangements: ['hybrid'], city: undefined }],
    [{ arrangements: ['remote', 'hybrid'], city: '   ' }],
  ])('requires a city for onsite or hybrid: %j', async (changes) => {
    expect(await errorsFor(changes)).toEqual(['city']);
  });

  it('says why the city is required', async () => {
    const dto = plainToInstance(CreateProfileDto, {
      ...validProfile,
      arrangements: ['onsite'],
      city: null,
    });
    const [error] = await validate(dto, options);
    expect(Object.values(error!.constraints ?? {})).toContain(CITY_REQUIRED);
  });

  it('accepts onsite with a city', async () => {
    expect(
      await errorsFor({ arrangements: ['onsite'], city: 'Rabat' }),
    ).toEqual([]);
  });

  it('accepts remote without a city', async () => {
    expect(await errorsFor({ arrangements: ['remote'], city: null })).toEqual(
      [],
    );
  });

  it('accepts unstated with no regions (remote defaults to GLOBAL)', async () => {
    expect(
      await errorsFor({ arrangements: ['unstated'], regions: [] }),
    ).toEqual([]);
  });

  it('applies to replacements too', async () => {
    const { position: _position, ...editable } = validProfile;
    const dto = plainToInstance(ReplaceProfileDto, {
      ...editable,
      arrangements: ['hybrid'],
      city: null,
    });
    expect(paths(await validate(dto, options))).toEqual(['city']);
  });
});
