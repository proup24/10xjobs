import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { TextLink } from '@/components/ui/text';
import type {
  AboutAnswers,
  EligibilityAnswers,
  JobAnswers,
  TermsAnswers,
} from '@/lib/setup/answers';
import {
  AUTHORIZATION_LABELS,
  LEVEL_LABELS,
  LINK_LABELS,
  formatFileSize,
} from '@/lib/setup/labels';
import { NOTICE_OPTIONS, formatOffset } from '@/lib/setup/options';
import { UNKNOWN, labeller, placeLabeler } from '@/lib/setup/place-label';
import { SETUP_STEPS, stepPath, type SetupStepId } from '@/lib/setup/steps';
import type { ValueLists } from '@/lib/setup/value-lists';
import { StepFrame } from './step-frame';

type Props = {
  about: AboutAnswers;
  eligibility: EligibilityAnswers;
  job: JobAnswers;
  terms: TermsAnswers;
  resume: { filename: string; sizeBytes: number };
  lists: ValueLists;
};

const PERIOD_WORDS = {
  hour: 'hour',
  day: 'day',
  month: 'month',
  year: 'year',
} as const;

function formatSalary(salary: NonNullable<TermsAnswers['salary']>): string {
  let amount: string;
  try {
    amount = new Intl.NumberFormat('en', {
      style: 'currency',
      currency: salary.currency,
      maximumFractionDigits: 0,
    }).format(salary.min);
  } catch {
    amount = `${salary.min.toLocaleString('en')} ${salary.currency}`;
  }
  return `${amount} per ${PERIOD_WORDS[salary.period]}`;
}

type Row = { term: string; values: string[] };

function StepCard({ step, rows }: { step: SetupStepId; rows: Row[] }) {
  const title = SETUP_STEPS.find((s) => s.id === step)?.label ?? step;
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          {title}
        </CardTitle>
        <CardAction>
          <TextLink href={stepPath(step)} aria-label={`Edit ${title}`}>
            Edit
          </TextLink>
        </CardAction>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-3">
          {rows.map((row) => (
            <div key={row.term} className="grid gap-1 sm:grid-cols-3 sm:gap-4">
              <dt className="text-muted-foreground">{row.term}</dt>
              <dd className="flex min-w-0 flex-col gap-1 break-words sm:col-span-2">
                {row.values.map((v, i) => (
                  <span key={i}>{v}</span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

/**
 * The summary after step 5: one card per step with an Edit link. Setup is already done
 * here, so Finish only goes home. Rendered on the server: the value lists stay there.
 */
export function Review({
  about,
  eligibility,
  job,
  terms,
  resume,
  lists,
}: Props) {
  const country = labeller(lists.countries);
  const region = labeller(lists.regions);
  const authorizationPlace = (code: string) =>
    lists.countries.some((c) => c.value === code)
      ? country(code)
      : region(code);
  const placeLabel = placeLabeler(lists);
  const position = labeller(lists.positions);
  const seniority = labeller(lists.seniorities);
  const tech = labeller(lists.techs);
  const language = labeller(lists.languages);
  const contractType = labeller(lists.contractTypes);
  const engagement = labeller(lists.engagements);
  const currency = labeller(lists.currencies);
  const notice =
    NOTICE_OPTIONS.find((o) => o.days === terms.noticePeriodDays)?.label ??
    UNKNOWN;

  const aboutRows: Row[] = [
    { term: 'Name', values: [about.name] },
    ...(about.phone ? [{ term: 'Phone', values: [about.phone] }] : []),
    ...(about.linkedin ? [{ term: 'LinkedIn', values: [about.linkedin] }] : []),
    ...(about.links.length
      ? [
          {
            term: 'Links',
            values: about.links.map(
              (l) => `${LINK_LABELS[l.kind]}: ${l.value}`,
            ),
          },
        ]
      : []),
  ];

  const eligibilityRows: Row[] = [
    {
      term: 'Country of residence',
      values: [country(eligibility.residenceCountry)],
    },
    {
      term: 'Visa sponsorship',
      values: [eligibility.acceptsSponsorship ? 'Yes' : 'No'],
    },
    {
      term: 'Work authorizations',
      values: eligibility.authorizations.length
        ? eligibility.authorizations.map(
            (a) =>
              `${AUTHORIZATION_LABELS[a.kind]}: ${authorizationPlace(a.place)}`,
          )
        : ["I don't hold any work authorization"],
    },
  ];

  const jobRows: Row[] = [
    { term: 'Position', values: [position(job.position)] },
    {
      term: 'Experience',
      values: [
        `${job.yearsOfExperience} ${job.yearsOfExperience === 1 ? 'year' : 'years'}`,
      ],
    },
    { term: 'Seniority', values: job.seniorities.map(seniority) },
    {
      term: 'Tech stack',
      values: job.techs.map(
        (t) => `${tech(t.code)}${t.rating === null ? '' : ` ${t.rating}/5`}`,
      ),
    },
    {
      term: 'Languages',
      values: job.languages.map(
        (l) => `${language(l.lang)}: ${LEVEL_LABELS[l.level]}`,
      ),
    },
  ];

  const termsRows: Row[] = [
    {
      term: "Where you'd work",
      values: terms.places.map((row) => {
        const ways = [
          row.remote && 'Remote',
          row.hybrid && 'Hybrid',
          row.onsite && 'On-site',
        ].filter(Boolean);
        return `${placeLabel(row.place)}: ${ways.join(', ')}`;
      }),
    },
    {
      term: 'Time zone',
      values: [
        `${formatOffset(terms.timezoneCurrent)}, working with ${formatOffset(terms.timezoneMin)} to ${formatOffset(terms.timezoneMax)}`,
      ],
    },
    { term: 'Contract types', values: terms.contractTypes.map(contractType) },
    { term: 'Hired as', values: terms.engagements.map(engagement) },
    { term: 'Notice period', values: [notice] },
    {
      term: 'Minimum salary',
      values: [terms.salary ? formatSalary(terms.salary) : 'No minimum'],
    },
    {
      term: 'Accepted currencies',
      values: terms.acceptsAnyCurrency
        ? ['Any currency']
        : terms.acceptedCurrencies.map(currency),
    },
  ];

  return (
    <StepFrame
      step="review"
      title="Review"
      pending={false}
      submitLabel="Finish"
      submitHref="/"
    >
      <div className="flex flex-col gap-4">
        <StepCard step="about" rows={aboutRows} />
        <StepCard step="eligibility" rows={eligibilityRows} />
        <StepCard step="job" rows={jobRows} />
        <StepCard step="terms" rows={termsRows} />
        <StepCard
          step="resume"
          rows={[
            {
              term: 'File',
              values: [
                `${resume.filename}, ${formatFileSize(resume.sizeBytes)}`,
              ],
            },
          ]}
        />
      </div>
    </StepFrame>
  );
}
