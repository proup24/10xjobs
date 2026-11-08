import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AboutAnswers,
  EligibilityAnswers,
  JobAnswers,
  TermsAnswers,
} from '@/lib/setup/answers';
import type { ValueLists } from '@/lib/setup/value-lists';
import { Review } from './review';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

afterEach(cleanup);

const CITY = '8f9c1a52-3b1e-4c7a-9d2e-1f0a2b3c4d5e';

const lists: ValueLists = {
  positions: [{ value: 'backend_engineer', label: 'Backend Engineer' }],
  seniorities: [{ value: 'senior', label: 'Senior' }],
  contractTypes: [{ value: 'full_time', label: 'Full Time' }],
  engagements: [{ value: 'employee', label: 'Employee' }],
  techs: [
    { value: 'typescript', label: 'TypeScript', searchable: true },
    { value: 'postgresql', label: 'PostgreSQL', searchable: true },
  ],
  languages: [{ value: 'en', label: 'English' }],
  currencies: [{ value: 'EUR', label: 'Euro' }],
  countries: [
    { value: 'FR', label: 'France' },
    { value: 'DE', label: 'Germany' },
  ],
  regions: [{ value: 'EU', label: 'European Union' }],
  cities: [{ value: CITY, label: 'Berlin, Germany' }],
};

const about: AboutAnswers = {
  name: 'Ada Lovelace',
  phone: '+33 1 23',
  linkedin: 'https://linkedin.com/in/ada',
  links: [{ kind: 'github', value: 'https://github.com/ada' }],
};

const eligibility: EligibilityAnswers = {
  residenceCountry: 'FR',
  acceptsSponsorship: true,
  authorizations: [
    { kind: 'citizenship', place: 'FR' },
    { kind: 'work-permit', place: 'EU' },
  ],
  noneConfirmed: false,
};

const job: JobAnswers = {
  position: 'backend_engineer',
  yearsOfExperience: 7,
  seniorities: ['senior'],
  techs: [
    { code: 'typescript', rating: 5, starred: true },
    { code: 'postgresql', rating: 3, starred: false },
  ],
  languages: [{ lang: 'en', level: 'fluent' }],
};

const terms: TermsAnswers = {
  places: [
    {
      place: { kind: 'worldwide' },
      remote: true,
      hybrid: false,
      onsite: false,
    },
    {
      place: { kind: 'city', id: CITY },
      remote: false,
      hybrid: true,
      onsite: true,
    },
  ],
  timezoneCurrent: 60,
  timezoneMin: -120,
  timezoneMax: 330,
  contractTypes: ['full_time'],
  engagements: ['employee'],
  noticePeriodDays: 30,
  salary: { min: 80_000, currency: 'EUR', period: 'year' },
  acceptsAnyCurrency: false,
  acceptedCurrencies: ['EUR'],
};

function setup() {
  return render(
    <Review
      about={about}
      eligibility={eligibility}
      job={job}
      terms={terms}
      resume={{ filename: 'cv.pdf', sizeBytes: 123_456 }}
      lists={lists}
    />,
  );
}

const card = (title: string) =>
  screen
    .getByRole('heading', { level: 2, name: title })
    .closest('[data-slot="card"]') as HTMLElement;

describe('Review', () => {
  it('one card per step with an Edit link to its path', () => {
    setup();
    const steps = [
      ['About you', '/setup/about'],
      ['Where you can work', '/setup/eligibility'],
      ['The job you want', '/setup/job'],
      ['Location and terms', '/setup/terms'],
      ['Resume', '/setup/resume'],
    ] as const;
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(
      steps.length,
    );
    for (const [title, path] of steps) {
      const link = within(card(title)).getByRole('link', {
        name: `Edit ${title}`,
      });
      expect(link.getAttribute('href')).toBe(path);
    }
  });

  it('Finish links to /', () => {
    setup();
    expect(
      screen.getByRole('link', { name: 'Finish' }).getAttribute('href'),
    ).toBe('/');
  });

  it('shows labels, never codes', () => {
    setup();
    const a = within(card('About you'));
    expect(a.getByText('Ada Lovelace')).toBeTruthy();
    expect(a.getByText('GitHub: https://github.com/ada')).toBeTruthy();

    const e = within(card('Where you can work'));
    expect(e.getByText('France')).toBeTruthy();
    expect(e.getByText('Yes')).toBeTruthy();
    expect(e.getByText('Citizenship: France')).toBeTruthy();
    expect(e.getByText('Work permit: European Union')).toBeTruthy();

    const j = within(card('The job you want'));
    expect(j.getByText('Backend Engineer')).toBeTruthy();
    expect(j.getByText('7 years')).toBeTruthy();
    expect(j.getByText('Senior')).toBeTruthy();
    expect(j.getByText('TypeScript 5/5, searched')).toBeTruthy();
    expect(j.getByText('PostgreSQL 3/5')).toBeTruthy();
    expect(j.getByText('English: Fluent')).toBeTruthy();

    const t = within(card('Location and terms'));
    expect(t.getByText('Worldwide: Remote')).toBeTruthy();
    expect(t.getByText('Berlin, Germany: Hybrid, On-site')).toBeTruthy();
    expect(t.getByText('UTC+1, working with UTC−2 to UTC+5:30')).toBeTruthy();
    expect(t.getByText('Full Time')).toBeTruthy();
    expect(t.getByText('Employee')).toBeTruthy();
    expect(t.getByText('1 month')).toBeTruthy();
    expect(t.getByText('€80,000 per year')).toBeTruthy();
    expect(t.getByText('Euro')).toBeTruthy();

    const r = within(card('Resume'));
    expect(r.getByText('cv.pdf, 121 KB')).toBeTruthy();

    for (const code of ['backend_engineer', 'full_time', 'FR', CITY]) {
      expect(screen.queryByText(new RegExp(code))).toBeNull();
    }
  });

  it('shows the empty answers plainly', () => {
    render(
      <Review
        about={{ name: 'Ada', phone: null, linkedin: null, links: [] }}
        eligibility={{
          ...eligibility,
          acceptsSponsorship: false,
          authorizations: [],
          noneConfirmed: true,
        }}
        job={job}
        terms={{
          ...terms,
          salary: null,
          acceptsAnyCurrency: true,
          acceptedCurrencies: [],
        }}
        resume={{ filename: 'cv.pdf', sizeBytes: 10 }}
        lists={lists}
      />,
    );
    expect(within(card('Where you can work')).getByText('No')).toBeTruthy();
    expect(
      within(card('Where you can work')).getByText(
        "I don't hold any work authorization",
      ),
    ).toBeTruthy();
    const t = within(card('Location and terms'));
    expect(t.getByText('No minimum')).toBeTruthy();
    expect(t.getByText('Any currency')).toBeTruthy();
    expect(within(card('About you')).queryByText('Phone')).toBeNull();
  });
});
