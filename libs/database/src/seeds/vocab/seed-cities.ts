/** One city the cities seed makes sure is approved. */
export interface SeedCity {
  name: string;
  countryCode: string;
  aliases: string[];
  geonamesId: number | null;
}

/**
 * A curated starter list of software-hiring hubs, reviewed by the maintainer;
 * edit by hand. The seed promotes and adds cities but never removes one.
 */
export const SEED_CITIES: readonly SeedCity[] = [
  { name: 'Abu Dhabi', countryCode: 'AE', aliases: [], geonamesId: null },
  { name: 'Dubai', countryCode: 'AE', aliases: [], geonamesId: null },
  { name: 'Vienna', countryCode: 'AT', aliases: ['Wien'], geonamesId: null },
  { name: 'Melbourne', countryCode: 'AU', aliases: [], geonamesId: null },
  { name: 'Sydney', countryCode: 'AU', aliases: [], geonamesId: null },
  {
    name: 'Brussels',
    countryCode: 'BE',
    aliases: ['Brussel', 'Bruxelles'],
    geonamesId: null,
  },
  {
    name: 'São Paulo',
    countryCode: 'BR',
    aliases: ['Sao Paulo'],
    geonamesId: null,
  },
  {
    name: 'Montreal',
    countryCode: 'CA',
    aliases: ['Montréal'],
    geonamesId: null,
  },
  { name: 'Toronto', countryCode: 'CA', aliases: [], geonamesId: null },
  { name: 'Vancouver', countryCode: 'CA', aliases: [], geonamesId: null },
  { name: 'Zurich', countryCode: 'CH', aliases: ['Zürich'], geonamesId: null },
  { name: 'Prague', countryCode: 'CZ', aliases: ['Praha'], geonamesId: null },
  { name: 'Berlin', countryCode: 'DE', aliases: [], geonamesId: null },
  {
    name: 'Frankfurt',
    countryCode: 'DE',
    aliases: ['Frankfurt am Main'],
    geonamesId: null,
  },
  { name: 'Hamburg', countryCode: 'DE', aliases: [], geonamesId: null },
  { name: 'Munich', countryCode: 'DE', aliases: ['München'], geonamesId: null },
  {
    name: 'Copenhagen',
    countryCode: 'DK',
    aliases: ['København'],
    geonamesId: null,
  },
  { name: 'Cairo', countryCode: 'EG', aliases: [], geonamesId: null },
  { name: 'Barcelona', countryCode: 'ES', aliases: [], geonamesId: null },
  { name: 'Madrid', countryCode: 'ES', aliases: [], geonamesId: null },
  { name: 'Helsinki', countryCode: 'FI', aliases: [], geonamesId: null },
  { name: 'Lyon', countryCode: 'FR', aliases: [], geonamesId: null },
  { name: 'Paris', countryCode: 'FR', aliases: [], geonamesId: null },
  { name: 'Edinburgh', countryCode: 'GB', aliases: [], geonamesId: null },
  { name: 'London', countryCode: 'GB', aliases: [], geonamesId: null },
  { name: 'Manchester', countryCode: 'GB', aliases: [], geonamesId: null },
  { name: 'Dublin', countryCode: 'IE', aliases: [], geonamesId: null },
  {
    name: 'Tel Aviv',
    countryCode: 'IL',
    aliases: ['Tel Aviv-Yafo'],
    geonamesId: null,
  },
  {
    name: 'Bangalore',
    countryCode: 'IN',
    aliases: ['Bengaluru'],
    geonamesId: null,
  },
  { name: 'Hyderabad', countryCode: 'IN', aliases: [], geonamesId: null },
  { name: 'Milan', countryCode: 'IT', aliases: ['Milano'], geonamesId: null },
  { name: 'Agadir', countryCode: 'MA', aliases: [], geonamesId: null },
  { name: 'Ben Guerir', countryCode: 'MA', aliases: [], geonamesId: null },
  {
    name: 'Casablanca',
    countryCode: 'MA',
    aliases: ['Mechouar', 'Prefecture of Casablanca'],
    geonamesId: null,
  },
  { name: 'Fès', countryCode: 'MA', aliases: ['Fez', 'Fes'], geonamesId: null },
  {
    name: 'Marrakech',
    countryCode: 'MA',
    aliases: ['Marrakesh'],
    geonamesId: null,
  },
  { name: 'Meknes', countryCode: 'MA', aliases: ['Meknès'], geonamesId: null },
  { name: 'Mohammedia', countryCode: 'MA', aliases: [], geonamesId: null },
  { name: 'Oujda', countryCode: 'MA', aliases: [], geonamesId: null },
  { name: 'Rabat', countryCode: 'MA', aliases: [], geonamesId: null },
  {
    name: 'Salé',
    countryCode: 'MA',
    aliases: ['Salé El Jadida'],
    geonamesId: null,
  },
  { name: 'Tangier', countryCode: 'MA', aliases: ['Tanger'], geonamesId: null },
  { name: 'Tétouan', countryCode: 'MA', aliases: [], geonamesId: null },
  { name: 'Amsterdam', countryCode: 'NL', aliases: [], geonamesId: null },
  { name: 'Rotterdam', countryCode: 'NL', aliases: [], geonamesId: null },
  { name: 'Oslo', countryCode: 'NO', aliases: [], geonamesId: null },
  { name: 'Krakow', countryCode: 'PL', aliases: ['Kraków'], geonamesId: null },
  {
    name: 'Warsaw',
    countryCode: 'PL',
    aliases: ['Warszawa'],
    geonamesId: null,
  },
  { name: 'Lisbon', countryCode: 'PT', aliases: ['Lisboa'], geonamesId: null },
  { name: 'Porto', countryCode: 'PT', aliases: [], geonamesId: null },
  {
    name: 'Bucharest',
    countryCode: 'RO',
    aliases: ['București'],
    geonamesId: null,
  },
  { name: 'Stockholm', countryCode: 'SE', aliases: [], geonamesId: null },
  { name: 'Singapore', countryCode: 'SG', aliases: [], geonamesId: null },
  { name: 'Austin', countryCode: 'US', aliases: [], geonamesId: null },
  { name: 'Boston', countryCode: 'US', aliases: [], geonamesId: null },
  {
    name: 'New York',
    countryCode: 'US',
    aliases: ['New York City', 'NYC'],
    geonamesId: null,
  },
  {
    name: 'San Francisco',
    countryCode: 'US',
    aliases: ['SF'],
    geonamesId: null,
  },
  { name: 'Seattle', countryCode: 'US', aliases: [], geonamesId: null },
];
