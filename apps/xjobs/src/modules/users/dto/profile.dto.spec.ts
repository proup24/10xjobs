import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { UpsertProfileDto } from './upsert-profile.dto';

const options = { whitelist: true, forbidNonWhitelisted: true };

const validProfile = {
  positions: ['backend_engineer'],
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
  techStack: [
    { technology: 'nodejs', domain: 'backend', mastery: 8 },
  ],
};

function paths(errors: ValidationError[], prefix = ''): string[] {
  return errors.flatMap((error) => {
    const path = prefix + error.property;
    return error.children?.length ? paths(error.children, `${path}.`) : [path];
  });
}

async function errorsFor(changes: object) {
  const dto = plainToInstance(UpsertProfileDto, {
    ...validProfile,
    ...changes,
  });
  return paths(await validate(dto, options));
}

describe('UpsertProfileDto', () => {
  it('accepts a full profile', async () => {
    expect(await errorsFor({})).toEqual([]);
  });

  it.each(['positions', 'languages', 'engagements', 'arrangements'])(
    'rejects an empty %s list',
    async (field) => {
      expect(await errorsFor({ [field]: [] })).toEqual([field]);
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
