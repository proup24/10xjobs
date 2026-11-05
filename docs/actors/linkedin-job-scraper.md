# LinkedIn Jobs Scraper | Remove Duplicate Jobs | Pay Per Result (`cheap_scraper/linkedin-job-scraper`) Actor

Scrape LinkedIn jobs by keywords and location or by LinkedIn search URLs, or both. Export to JSON, CSV or Excel. No login or cookies needed. Filter jobs, filter with AI, remove duplicates, add company data, and automate with n8n, Make, Zapier or AI agents.

- **URL**: https://apify.com/cheap_scraper/linkedin-job-scraper.md
- **Developed by:** [cheap_scraper](https://apify.com/cheap_scraper) (community)
- **Categories:** Jobs, Developer tools
- **Stats:** 55,531 total users, 4,328 monthly users, 99.9% runs succeeded, 234 bookmarks
- **User rating**: 4.37 out of 5 stars

## Pricing

from $0.35 / 1,000 results

This Actor is paid per event. You are not charged for the Apify platform usage, but only a fixed price for specific events.
Since this Actor supports Apify Store discounts, the price gets lower the higher subscription plan you have.

Learn more: https://docs.apify.com/actors/running/actors-in-store.md#pay-per-event

## What's an Apify Actor?

An Actor is a serverless cloud program that runs on the Apify platform. It has two run modes.
In Batch mode, an Actor accepts a well-defined JSON input, performs an action which can take anything from a few seconds to a few hours,
and optionally produces a well-defined JSON output, datasets with results, or files in key-value store.
In Standby mode, an Actor provides a web server which can be used as a website, API, or an MCP server.

Apify vocabulary and the platform model are defined once, in the agent quickstart at https://apify.com/agents.md.

## How to integrate an Actor?

If asked about integration, you help developers integrate Actors into their projects.
You adapt to their stack and deliver integrations that are safe, well-documented, and production-ready.

Do not guess an integration path. Every one of them is in the agent quickstart at https://apify.com/agents.md: the Apify MCP server, Agent Skills with the Apify CLI, the JavaScript and Python clients, the REST API, and the account-free path for an agent with no human to sign in. It also carries the rule on stating cost before the first paid run.

For examples already wired to this Actor's own input schema, see the [API](#api) section below.

Each client library has reference documentation the quickstart does not restate: [JavaScript/TypeScript](https://docs.apify.com/api/client/js/docs.md) (`npm install apify-client`) and [Python](https://docs.apify.com/api/client/python/docs.md) (`pip install apify-client`).

# README

**LinkedIn Jobs Scraper** is a LinkedIn Jobs API alternative that runs on Apify: it turns public LinkedIn job postings into clean, structured **JSON, CSV or Excel** data you can use anywhere. **No LinkedIn account, no login and no cookies needed**, and no coding. You only pay for the jobs you get ([see pricing](#linkedin-jobs-scraper-pricing)), and you get Apify's scheduling, monitoring, API access and integrations built in.

**What you get for every job:** title, company, location, salary (when listed), full description, job type, experience level, application link, posting date, number of applicants and, when LinkedIn shows one, the recruiter or poster. Optionally add company details (website, address, industry, employee count, specialties) at no extra cost. That is **40+ data fields per job**, see the [full output fields](#output-fields). You can also let AI answer your own questions about each job (paid plans).

#### At a glance

| | |
| --- | --- |
| **What it is** | A LinkedIn jobs scraper and API alternative for public LinkedIn job listings |
| **Search by** | Keywords and locations, or LinkedIn job search URLs, or both together |
| **Filters** | Date posted, work type (remote, hybrid, on-site), job type, experience level, Easy Apply, company, plus extra filters and scoring to keep only the jobs you care about |
| **AI job filter** | Ask multiple-choice questions about each job (remote? visa sponsorship? language?) and get an AI answer per job. Paid Apify plans only ([details](#-ai-dynamic-filter-apify-paid-plans-only)) |
| **Duplicates** | Optional removal of duplicate jobs, so you don't pay twice |
| **Export formats** | JSON, CSV, Excel, XML, HTML, RSS |
| **Ways to run** | Apify Console, scheduled runs, API, webhooks, n8n, Make.com, Zapier |
| **LinkedIn account needed** | No: no login, no cookies, no credentials |

#### Use it your way

- 📊 **Explore it**: download the results as Excel, CSV or JSON for analysis, dashboards, market research or your own job hunt.
- 🔁 **Automate it**: run it on a schedule or with webhooks and connect it to n8n, Make.com, Zapier, Google Sheets, Slack, Notion or a CRM, for example for job alerts, newsletters, job boards or lead lists.
- 🤖 **Feed your AI agents**: give fresh job data to AI agents and LLM workflows (Claude, ChatGPT, n8n agents and more) through the Apify API or Apify's MCP server, for example to tailor a resume, qualify leads or draft outreach. Built-in filters and scoring remove irrelevant jobs first, so your AI only processes what matters.
- 🛠️ **Build on it**: pull the data through the Apify API (Python, Node.js or cURL) into your own app, database or research pipeline.

**Common uses:** recruiting and talent sourcing, job hunting, hiring-trend and salary research, competitor hiring monitoring, B2B lead generation, and job boards or newsletters.

#### Get started in 3 steps

1. Enter keywords and a location, or paste one or more LinkedIn job search URLs.
2. Click **Start**.
3. Download the results or send them to your tools.

You can run many searches at once: each search returns up to 1,000 jobs, and all results land in one dataset ([details](#how-to-scrape-linkedin-jobs)). Prefer to watch first? See the [video tutorials](#linkedin-jobs-scraper-tutorial).

### LinkedIn Jobs Scraper Pricing

Pay only for the jobs you get. There is no monthly fee for the Actor, and the price per 1,000 jobs goes down as your Apify plan goes up. You can try it on the Free plan, where the first jobs are covered by your free Apify credits.

| Event Type                                         | 🆓 Free Tier | 🥉 Bronze Tier | 🥈 Silver Tier | 🥇 Gold Tier |
| ------------------------------------------------- | ------------ | -------------- | -------------- | ------------ |
| **Job Result Event** (per 1,000 jobs)             | $0.7         | $0.60          | $0.50          | $0.35        |
| **AI Job Analysis Event** (per 1,000 analyses) \* | N/A          | $0.50          | $0.50          | $0.50        |

\* The AI job analysis event only applies when you enable [**Use AI Job Description Parsing**](#-ai-dynamic-filter-apify-paid-plans-only). It is charged once for each job the AI successfully analyses, however many questions you ask, and the price is the same on every tier. The AI filter is not available on the Free plan, so no AI event is charged there.

**Example costs:**

- Scraping 500 jobs on Free Tier: **$0.35**
- Scraping 5,000 jobs on Silver Tier: **$2.50**
- Scraping 1,000 jobs on Bronze Tier with the AI filter, if all 1,000 are analysed: **$0.60 + $0.50 = $1.10**

💡 **Save money**: enable `saveOnlyUniqueItems` to avoid paying for duplicate job postings. Enabling `enrichCompanyData` is free: it does not increase the price per result, the run just may take longer.

#### Good to know

- **AI filter cost**: the AI only analyses jobs that passed every other dynamic filter, so adding dynamic filters (for example `requireSalaryInfo`) lowers the number of AI events you pay for. Jobs where the AI is skipped or fails are never charged for the AI.
- **Actor start fee**: each run also incurs a small fixed Apify actor start fee based on the memory size you choose: **0.005 dollars per GB**. The default 4GB machine costs up to **0.02 dollars** per run. It is charged once per run, regardless of how many jobs are scraped.
- **Actor timeout**: the actor automatically terminates after 25 minutes.

### LinkedIn Jobs Scraper Tutorial

Watch the official tutorials to get started quickly:

📺 **How to use the LinkedIn Jobs Scraper**

https://youtu.be/7oZorJOOa5Y

📺 **Build a Free Automated LinkedIn Job Newsletter with Make.com & Apify**

https://youtu.be/m8wtzKLcMEk

📺 **Build Any Apify Actor Input with AI: No Docs, No Code**

https://youtu.be/Tdo97xB_L9Q

#### Community Tutorials

Made by the community using this actor:

- [📺 Build a LinkedIn Job Scraping & Lead Generation System with N8N, Apollo & Notion](https://www.youtube.com/watch?v=DC8ftiBiP2c)
- [📺 Scrape 1,000+ LinkedIn Jobs for 35 Cents Using Apify (Step-by-Step Guide)](https://www.youtube.com/watch?v=nxhJJCMVl-0)
- [📺 Scrape LinkedIn Jobs, Auto-Customize Your Resume with AI & Find Hiring Manager Emails (N8N)](https://www.youtube.com/watch?v=00OMIR7tCD4)
- [📺 Turn 1,000 LinkedIn Jobs Into Sales Leads with an AI Outreach Assistant (N8N)](https://www.youtube.com/watch?v=ZPZF_yfWEF8)

### Who Uses a LinkedIn Jobs Scraper?

- **Automation builders**: schedule runs and send fresh jobs to n8n, Make.com, Zapier, Google Sheets, Slack, Notion or a CRM. Use `dynamicFilterMatch` and `keywordMatchScorePercentage` to pass only relevant jobs downstream and cut noise and processing costs.
- **AI and agent developers**: give your agents and LLM workflows structured job and company data (resume tailoring, lead qualification, outreach drafts). Filter first so the AI only reads jobs worth the tokens.
- **Recruiters & HR professionals**: build talent pipelines and track competitors' openings, salary ranges and in-demand skills.
- **Job seekers**: gather opportunities from many searches in one place, compare salaries and get direct application links without browsing LinkedIn manually.
- **Market researchers, analysts & BI teams**: analyze hiring trends, skill requirements, remote work adoption and company growth, and build dashboards over time.
- **Developers & sales teams**: pull job and company data through the API to power your own product, or to find companies that are hiring.

**Key benefits:**

- ✅ **Pay only for results**: you are charged for the jobs you get, with no monthly fee for the Actor.
- ✅ **No coding required**: a simple form with clear options, or the API if you prefer code.
- ✅ **Duplicate prevention**: an optional unique-only mode saves you money.
- ✅ **Rich company data**: optional enrichment adds company details, addresses and employee counts at no extra charge.
- ✅ **Flexible search**: use LinkedIn URLs or keywords, or combine both.
- ✅ **Ready-to-use data**: JSON, CSV or Excel exports.

### FAQ

#### Will my LinkedIn account get blocked or banned?

No. The scraper only accesses LinkedIn's public job pages — the same pages anyone can view without logging in. Your LinkedIn account is never used or required.

#### Can I scrape LinkedIn jobs without logging in or using a LinkedIn account?

Yes. The scraper only reads publicly available job listings, the same pages anyone can open without an account. No login, no cookies, no credentials and no LinkedIn account are needed.

#### Is it legal to scrape LinkedIn job postings?

Yes. This scraper only collects data from LinkedIn's public pages that are accessible to anyone without an account. It does not bypass any login or access private data.

#### Is there a free LinkedIn jobs scraper?

You can try it for free on Apify's Free plan, which comes with free monthly platform credits, and there is no flat monthly fee for the Actor. Beyond that you only pay for the jobs you get, see the [Pricing](#linkedin-jobs-scraper-pricing) table. The AI filter needs a paid Apify plan.

#### How much does it cost to scrape LinkedIn jobs?

You pay per 1,000 jobs, and the price depends on your Apify plan. See the [Pricing](#linkedin-jobs-scraper-pricing) table. There is no flat monthly fee for the Actor.

#### How many jobs can I scrape?

Up to 1,000 jobs **per search** (per keyword/location combination or per LinkedIn search URL). This is a LinkedIn limitation, not the scraper's, and it is **not** a limit per run. Put several keywords, locations or URLs in one run to collect thousands of jobs (subject to `maxItems`). See [How to Scrape LinkedIn Jobs](#how-to-scrape-linkedin-jobs) for a concrete example.

#### Do I need coding skills to use this?

No. Everything is configured through a simple form on Apify. Just fill in your keywords, location, and filters and click Run.

#### Is there a LinkedIn jobs scraper API?

Yes. Every Apify Actor can be started and read through the Apify API, so you can trigger runs and fetch the results from your own app, script, automation or AI agent. This Actor is a LinkedIn Jobs API alternative: LinkedIn has no public jobs API, and this one returns the public job listings as structured JSON.

#### Can I scrape LinkedIn jobs with Python?

Yes. Use the Apify Python client (`pip install apify-client`) to run the Actor and read the results:

```python
from apify_client import ApifyClient

client = ApifyClient("<YOUR_APIFY_TOKEN>")

run = client.actor("cheap_scraper/linkedin-job-scraper").call(
    run_input={
        "keyword": ["Python Developer"],
        "locations": ["Montreal, Canada"],
        "publishedAt": "r604800",
        "saveOnlyUniqueItems": True,
        "maxItems": 100,
    }
)

for job in client.dataset(run["defaultDatasetId"]).iterate_items():
    print(job["jobTitle"], "-", job["companyName"])
```

A JavaScript client (`apify-client` on npm) and a plain REST API are also available.

#### Is there a LinkedIn jobs scraper on GitHub or a Chrome extension?

You can find open-source scripts on GitHub, but you have to host, maintain and fix them yourself when LinkedIn changes. This Actor runs in the cloud on Apify, so there is nothing to install: no browser extension, no code to maintain and no use of your LinkedIn account, which also means no risk to it.

#### Can I export the results to Excel or Google Sheets?

Yes. Apify lets you download your results in CSV, Excel, or JSON format directly from the dashboard — no coding required.

#### Can I run it automatically on a schedule?

Yes. Apify has a built-in scheduler. Set it to run daily, weekly, or at any interval and get fresh job data automatically without any manual work.

#### Can I connect it to Make.com, Zapier, or n8n?

Yes. Apify integrates natively with Make.com, Zapier, and n8n so you can automatically send job results to Google Sheets, Slack, a CRM, or any other tool in your workflow.

#### Can I use it with AI agents or my own code?

Yes. Run it and fetch the results through the Apify API, so your AI agents, scripts and apps can use the data directly.

#### Can I scrape jobs from specific companies only?

Yes. Use the `companyInclude` input field to restrict results to a list of company names. The scraper will resolve each name to a LinkedIn company ID and return only their job postings.

### How to Scrape LinkedIn Jobs

The LinkedIn job scraper allows you to collect jobs in 2 ways:

1. By providing one or more start URLs, or
2. By entering keyword-based search queries.

You can use either method individually or combine both.

**The 1,000-job limit applies per individual LinkedIn search, NOT per Actor run.** For example, ONE run with these 3 searches:

| Search                          | Jobs returned (max) |
| ------------------------------- | ------------------- |
| "Software Engineer" in Toronto  | up to 1,000         |
| "Software Engineer" in Montreal | up to 1,000         |
| "Data Scientist" in Vancouver   | up to 1,000         |
| **Total in one run**            | **up to 3,000**     |

The total can be lower if the same job appears in several searches and `saveOnlyUniqueItems` is enabled (it is saved only once), or if you set a lower `maxItems`.

**What happens when you combine several searches in one run?**

- Every `startUrls` entry is its own search (up to 1,000 jobs each).
- `keyword` + `locations` generate **additional** searches (one per keyword/location combination). They never modify your `startUrls`.
- All results from all searches are collected in the **same dataset**.
- With `saveOnlyUniqueItems: true`, a job found by several searches is saved only once.

Example: 3 URLs in `startUrls` + 2 keywords × 2 locations = 7 searches in one run, all merged into one dataset.

**Three kinds of filters, three different behaviors:**

| Type                                                                | Effect                                                  | Billed?                               |
| ------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------- |
| **Keyword Search Filters** (LinkedIn search filters)                | Change which jobs LinkedIn returns                      | Only returned jobs are scraped        |
| **Universal Filters** (`subLocationExclude`, `companyExclude`, ...) | Skip jobs before their page is fetched                  | Skipped jobs are **not** billed       |
| **Dynamic Filters**                                                 | Flag jobs after they are fetched (`dynamicFilterMatch`) | Every scraped job is saved and billed |

#### LinkedIn AI-Powered Search Mode

⚠️ Important update: LinkedIn changed its search, see the [video explaining the update](https://youtu.be/oD5FAQSPOCc).

LinkedIn randomly serves either its classic search engine or a newer AI-powered search, **regardless of whether you use URL-based or keyword-based search**.

- **Classic search**: all filters (`workType`/`jobType`/`experienceLevel`, plus the ones listed in Keyword Search Filters below) are enforced directly.
- **AI-powered search**: LinkedIn ignores `workType`/`jobType`/`experienceLevel` as filters. The scraper compensates by rewriting your search query in plain language instead (e.g. `"Remote Software Engineer"`), since LinkedIn's AI search understands intent phrased this way.

##### How AI Search Query Rewriting Works

Only the `keywords` part of the search changes; location, time posted, and sort order are untouched. Where the rewrite gets its values depends on your search mode:

- **Keyword-based search**: uses the `workType`/`jobType`/`experienceLevel` field values you provided.
- **URL-based search**: independent of any input fields. It's based on whatever `f_WT`/`f_JT`/`f_E` parameters are already present in the URL (e.g. because you applied those filters on linkedin.com before copying it).

**The rule** (applied independently, per filter):

- 1 value selected for that filter → bare label (e.g. `Remote`)
- 2+ values selected for that filter → `(Value1 OR Value2 OR ...)`

**Assembly order**: `[workType fragment] [jobType fragment] [experienceLevel fragment] [original keywords]`

| `workType`     | `jobType`           | `experienceLevel`                  | Rewritten query                                                     |
| -------------- | ------------------- | ---------------------------------- | ------------------------------------------------------------------- |
| Remote         | —                   | —                                  | `Remote software engineer`                                          |
| Remote, Hybrid | —                   | —                                  | `(Remote OR Hybrid) software engineer`                              |
| —              | Full-time, Contract | —                                  | `(Full-time OR Contract) software engineer`                         |
| —              | —                   | Entry level, Associate             | `(Entry level OR Associate) software engineer`                      |
| Remote         | —                   | Entry level, Internship, Associate | `Remote (Entry level OR Internship OR Associate) software engineer` |

**If you don't want the actor to rewrite your query:**

- Keyword-based search: leave `workType`/`jobType`/`experienceLevel` empty and phrase the intent directly in `keyword` (e.g. `"Remote Entry Level Software Engineer"`).
- URL-based search: don't apply those filters on linkedin.com before copying the URL, phrase the intent in the LinkedIn search box instead, so the copied URL has no `f_WT`/`f_JT`/`f_E` params for the scraper to react to.

### Input

The LinkedIn scraper's input is divided into 7 sections:

#### 🔍 Search

Use this section to tell the scraper where to start. You can provide LinkedIn job search URLs directly, use keywords to let the scraper build the URLs for you, or combine both.

📺 [Watch this section explained in the tutorial video](https://www.youtube.com/watch?v=7oZorJOOa5Y\&t=64s)

**How to get a LinkedIn job search URL:**

1. Open a **private/incognito browser window** (to avoid personalised results)
2. Go to <https://www.linkedin.com/jobs>
3. Search for a job title and apply any filters you want
4. Copy the URL from the address bar and paste it in the Start URLs field

| Input name  | Type                | Description / Behavior                                                                                                                                                              | Example                                                                                                |
| ----------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `startUrls` | `{ url: string }[]` | One or more LinkedIn Job Search URLs to start crawling from. Use this when you want to set filters directly on LinkedIn in your browser. See the URL generation instructions above. | `[{ "url": "https://www.linkedin.com/jobs/search?keywords=Developer&location=Canada&f_TPR=r604800" }]` |
| `keyword`   | `string[]`          | Job titles or search terms for keyword-based search. Combined with `locations` to generate one search URL per keyword/location combination.                                         | `["Software Engineer", "Data Scientist"]`                                                              |

#### 📍 Keyword Search Filters

These filters are sent directly to LinkedIn's search engine as part of the search URL. They **only apply to keyword-based search** and have no effect on URL-based search.

📺 [Watch this section explained in the tutorial video](https://www.youtube.com/watch?v=7oZorJOOa5Y\&t=209s)

| Input name                | Type       | Description / Behavior                                                                                                                                                                         | Example                                   |
| ------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `locations`               | `string[]` | Locations to search in. Each location is paired with every keyword to generate one search URL per combination. Preferred over the legacy `location` field.                                     | `["Montreal, Canada", "Toronto, Canada"]` |
| `location`                | `string`   | *(Legacy)* Single location string. Merged with `locations` when building searches. Use `locations` instead.                                                                                    | `"Montreal, Canada"`                      |
| `distance`                | `string`   | Search radius in miles. Accepted values: `""` (default), `"5"`, `"10"`, `"15"`, `"25"`, `"50"`.                                                                                                | `"25"`                                    |
| `publishedAt`             | `string`   | Filter by posting date. Accepted values: `""` (any time), `"r86400"` (last 24 h), `"r604800"` (last 7 days), `"r2592000"` (last 30 days).                                                      | `"r604800"`                               |
| `jobType`                 | `string[]` | Filter by employment type. Multiple values allowed. Accepted values: `"full-time"`, `"part-time"`, `"contract"`, `"temporary"`, `"internship"`, `"volunteer"`.                                 | `["full-time", "contract"]`               |
| `experienceLevel`         | `string[]` | Filter by experience level. Multiple values allowed. Accepted values: `"internship"`, `"entry-level"`, `"associate"`, `"mid-senior"`, `"director"`, `"executive"`.                             | `["entry-level", "associate"]`            |
| `workType`                | `string[]` | Filter by work location type. Multiple values allowed. Accepted values: `"on-site"`, `"remote"`, `"hybrid"`. Search filter only, sent to LinkedIn. Not related to the output field `workType`. | `["remote", "hybrid"]`                    |
| `companyInclude`          | `string[]` | Restrict the search to specific companies by name. Each name is resolved to a LinkedIn company ID — unresolved names are silently skipped.                                                     | `["Google", "Shopify"]`                   |
| `filterUnder10Applicants` | `boolean`  | When `true`, only returns jobs with fewer than 10 applicants.                                                                                                                                  | `true`                                    |
| `filterEasyApply`         | `boolean`  | When `true`, only returns Easy Apply jobs (apply directly on LinkedIn without leaving the site).                                                                                               | `true`                                    |

> 🤖 **AI search note**: see [🤖 AI-Powered Search Mode](#linkedin-ai-powered-search-mode) above certain filters in this table stop working as real filters when LinkedIn serves its AI-powered search, and the scraper compensates with a query rewrite instead.

#### 🔽 Universal Filters

These filters apply to **both keyword-based and URL-based** searches. Jobs that match an exclusion rule are skipped entirely and are **not fetched or billed**.

📺 [Watch this section explained in the tutorial video](https://www.youtube.com/watch?v=7oZorJOOa5Y\&t=451s)

| Input name           | Type       | Description / Behavior                                                                                                                                               | Example                                                             |
| -------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `subLocationExclude` | `string[]` | Skip jobs from specific cities or sub-areas. Any job whose location string contains the provided name (case-insensitive substring) is excluded before being fetched. | `["Laval", "Longueuil"]` — skips any job in "Laval, Quebec, Canada" |
| `companyExclude`     | `string[]` | Skip jobs from specific companies. Exact case-insensitive match against the company name on the job card.                                                            | `["Randstad", "Adecco"]`                                            |
| `jobTitleExclude`    | `string[]` | Skip jobs whose title contains any of these keywords (whole-word, case-insensitive). `"senior"` excludes "Senior Software Engineer" but not "seniority".             | `["senior", "manager", "director"]`                                 |

#### 🔎 Dynamic Filters

📺 [Watch this section explained in the tutorial video](https://www.youtube.com/watch?v=7oZorJOOa5Y\&t=552s)

> ⚠️ **These are NOT LinkedIn search filters** — they do not change which jobs LinkedIn returns to you. Jobs are always fetched first and billed, then evaluated against your criteria.

**Works equally for both search modes.** Because filtering happens after the job page is fetched, it applies regardless of whether you used URL-based search or keyword-based search.

**Every job is still saved to the dataset.** When a job does not match your dynamic filter criteria, it is still written to the dataset but the field `dynamicFilterMatch` will be set to `false`. Jobs that pass (or when no filters are set) will have `dynamicFilterMatch` set to `true`.

> ⚠️ **Dynamic filters do NOT prevent jobs from being scraped or billed.** To keep only matching jobs in Make.com, n8n, Zapier, Google Sheets or any other tool, filter the dataset on `dynamicFilterMatch = true`.

**One field for all filters.** If you configure several dynamic filters, you only need to check `dynamicFilterMatch` once: it is the combined result of all of them (a job must pass every configured filter to get `true`).

Example: with `{ "excludeRecruitingAgencies": true, "requireSalaryInfo": true }`, a job from a "Staffing and Recruiting" company **and** a job with no salary both get `dynamicFilterMatch: false`. Only a job from a non-staffing company that lists a salary gets `true`.

**How `excludeRecruitingAgencies` works:** it flags a job with `dynamicFilterMatch: false` **only** when the company's LinkedIn industry (`companyIndustry`) is exactly `"Staffing and Recruiting"`. Any other industry passes, and it does not analyze the company name, description or job title. For example, a company named "ABC Staffing" whose LinkedIn industry is `"Human Resources Services"` is **not** excluded. If the company industry is unavailable, the job passes.

**How `jobIndustryExclude` works:** it checks the **job's** industry (the output field `sector`), not the company's. Several values are allowed, and a match on any of them gives `dynamicFilterMatch: false`:

```json
{
  "jobIndustryExclude": ["Retail Apparel and Fashion", "Advertising Services"]
}
```

Industry names must match LinkedIn's classification names exactly.

| Input name                       | Type       | Description / Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Example                                                                                                                    |
| -------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `jobIndustryInclude`             | `string[]` | Keep only jobs whose industry matches **one of** these values. Takes priority over `jobIndustryExclude` when both are set. Values must match LinkedIn names exactly (e.g. `"Software Development"`). You can find all the Linkedin industries at [full list](https://learn.microsoft.com/en-us/linkedin/shared/references/reference-tables/industry-codes-v2)                                                                                                                                                                           | `["Software Development", "IT Services and IT Consulting"]` — only those industries get `dynamicFilterMatch: true`         |
| `jobIndustryExclude`             | `string[]` | Flag jobs whose industry (the output field `sector`, i.e. the job's industry, not the company's) matches **any of** these values as `dynamicFilterMatch: false`. Ignored when `jobIndustryInclude` is also set. You can find all the Linkedin industries at [full list](https://learn.microsoft.com/en-us/linkedin/shared/references/reference-tables/industry-codes-v2)                                                                                                                                                                | `["Staffing and Recruiting"]` — agency-posted jobs get `dynamicFilterMatch: false`                                         |
| `excludeRecruitingAgencies`      | `boolean`  | When `true`, jobs whose company has the LinkedIn industry `"Staffing and Recruiting"` (`companyIndustry`) are flagged with `dynamicFilterMatch: false`. It does not analyze the company name or description. Automatically enables `enrichCompanyData`.                                                                                                                                                                                                                                                                                 | `true` — result: `{ "companyIndustry": "Staffing and Recruiting", "dynamicFilterMatch": false }`                           |
| `companySizeMin`                 | `number`   | Flag jobs from companies with **fewer** employees than this value as `dynamicFilterMatch: false`. Companies with no employee count on LinkedIn always pass. Automatically enables `enrichCompanyData`.                                                                                                                                                                                                                                                                                                                                  | `50` — companies with fewer than 50 employees get `dynamicFilterMatch: false`                                              |
| `companySizeMax`                 | `number`   | Flag jobs from companies with **more** employees than this value as `dynamicFilterMatch: false`. Companies with no employee count on LinkedIn always pass. Automatically enables `enrichCompanyData`.                                                                                                                                                                                                                                                                                                                                   | `500` — to target mid-size companies combine with `companySizeMin`: `{ "companySizeMin": 50, "companySizeMax": 500 }`      |
| `companyOrganizationTypeInclude` | `string[]` | Keep only jobs from companies whose **company page organization type** matches one of these values. Takes priority over `companyOrganizationTypeExclude` when both are set. Automatically enables `enrichCompanyData`. If unavailable, the job always passes. Accepted values: `"Public Company"`, `"Educational"`, `"Self Employed"`, `"Government Agency"`, `"Non Profit"`, `"Self Owned"`, `"Privately Held"`, `"Partnership"`. See [full list](https://learn.microsoft.com/en-us/linkedin/shared/references/fields/company-profile) | `["Privately Held", "Public Company"]`                                                                                     |
| `companyOrganizationTypeExclude` | `string[]` | Flag jobs from companies whose **company page organization type** matches any of these values as `dynamicFilterMatch: false`. Ignored when `companyOrganizationTypeInclude` is set. Automatically enables `enrichCompanyData`. If unavailable, the job always passes. See [full list](https://learn.microsoft.com/en-us/linkedin/shared/references/fields/company-profile)                                                                                                                                                              | `["Self Employed", "Self Owned"]`                                                                                          |
| `companyFoundedDateMin`          | `number`   | Keep only jobs from companies founded **in or after** this year. Automatically enables `enrichCompanyData`. If the founding year is unavailable, the job always passes.                                                                                                                                                                                                                                                                                                                                                                 | `2010`                                                                                                                     |
| `companyFoundedDateMax`          | `number`   | Keep only jobs from companies founded **in or before** this year. Automatically enables `enrichCompanyData`. If the founding year is unavailable, the job always passes. Combine with `companyFoundedDateMin` to target a range.                                                                                                                                                                                                                                                                                                        | `2020` — to target companies founded between 2010–2020: `{ "companyFoundedDateMin": 2010, "companyFoundedDateMax": 2020 }` |
| `companyFollowersCountMin`       | `number`   | Keep only jobs from companies with **at least** this many LinkedIn followers. Automatically enables `enrichCompanyData`. If the follower count is unavailable, the job always passes.                                                                                                                                                                                                                                                                                                                                                   | `10000`                                                                                                                    |
| `companyFollowersCountMax`       | `number`   | Keep only jobs from companies with **at most** this many LinkedIn followers. Automatically enables `enrichCompanyData`. If the follower count is unavailable, the job always passes.                                                                                                                                                                                                                                                                                                                                                    | `500000`                                                                                                                   |
| `requireRecruiterProfile`        | `boolean`  | When `true`, only jobs that have a recruiter/poster profile associated with the posting get `dynamicFilterMatch: true`. It only checks that a poster is shown; it does not verify the person's hiring authority. Jobs without a poster are still collected and billed, but get `dynamicFilterMatch: false`.                                                                                                                                                                                                                             | `true`                                                                                                                     |
| `requireSalaryInfo`              | `boolean`  | When `true`, only jobs that include salary information in the posting get `dynamicFilterMatch: true`. Jobs without salary info are still collected and billed.                                                                                                                                                                                                                                                                                                                                                                          | `true`                                                                                                                     |

#### 🤖 AI Dynamic Filter (Apify paid plans only)

> ⚠️ **This input is for premium (paid Apify plan) users only.** On a free plan, the AI filter is **not** applied: a warning is logged before scraping and every job gets `aiStatus: "skipped_free_plan"`.

Turn on **Use AI Job Description Parsing** (`useAiJobDescriptionParsing`, default `false`) to use `aiQuestions`. The input form comes with an example already filled in, so you can see the format. The questions are only used when the option is enabled; otherwise they are ignored and no AI is used.

`aiQuestions` asks the AI multiple-choice questions about each job description. Like the other dynamic filters, it does not change which jobs are fetched or billed. Add `expected` values to also use a question as a filter: if the AI picks another choice, the job gets `dynamicFilterMatch: false`. Questions without `expected` only add information to the output.

```json
{
  "useAiJobDescriptionParsing": true,
  "aiQuestions": [
    {
      "id": "workModel",
      "question": "Is this job remote, hybrid or on site?",
      "choices": [
        "remote | Work fully from home",
        "hybrid | Mix of office and home",
        "on-site | Work fully at the employer's location",
        "unknown | The description does not say"
      ],
      "expected": ["remote", "hybrid"]
    },
    {
      "id": "visaSponsorship",
      "question": "Does the employer offer visa sponsorship?",
      "choices": [
        "yes | The description says visa sponsorship or work permit support is offered",
        "no | The description says sponsorship is not offered or work authorization is required",
        "unknown | The description does not mention it"
      ],
      "expected": ["yes"]
    },
    {
      "id": "language",
      "question": "Which languages must the candidate speak?",
      "choices": [
        "english only",
        "french only",
        "english and french | Fluency in both languages is required",
        "other | Any other language requirement",
        "unknown | The description does not say"
      ]
    }
  ]
}
```

What each question does in this example:

- **`workModel` (filter):** only `remote` and `hybrid` jobs keep `dynamicFilterMatch: true`. `on-site` and `unknown` jobs get `false`.
- **`visaSponsorship` (filter):** only jobs where the AI answers `yes` keep `dynamicFilterMatch: true`. Jobs answering `no` or `unknown` get `false`. To also keep jobs that don't mention it, use `"expected": ["yes", "unknown"]`.
- **`language` (information only):** there is no `expected`, so it never changes `dynamicFilterMatch`. It only adds the language requirement to `aiAnswers`, which is handy for sorting or filtering the dataset yourself.

A job must pass both filter questions to keep `dynamicFilterMatch: true`. For one job, the output looks like this:

```json
{
  "dynamicFilterMatch": false,
  "aiStatus": "answered",
  "aiAnswers": [
    {
      "id": "workModel",
      "question": "Is this job remote, hybrid or on site?",
      "answer": "remote",
      "probability": 0.94,
      "matched": true
    },
    {
      "id": "visaSponsorship",
      "question": "Does the employer offer visa sponsorship?",
      "answer": "unknown",
      "probability": 0.81,
      "matched": false
    },
    {
      "id": "language",
      "question": "Which languages must the candidate speak?",
      "answer": "english only",
      "probability": 0.88,
      "matched": null
    }
  ]
}
```

- **Answer choices with descriptions:** each choice is one line written as `answer | optional description`. The part before the first `|` is the answer the AI can pick, and the optional part after it tells the AI what the answer means, which helps with ambiguous options. Without a `|`, there is no description. An answer itself cannot contain `|`. `expected` lists the answer texts only.
- **Only runs when useful:** the AI runs only on jobs that passed every other dynamic filter, since it can only exclude jobs. Jobs that already failed get `aiStatus: "skipped"`.
- **Combined result:** every question with `expected` must match, and the result is merged into the single `dynamicFilterMatch` field.
- **No automatic "unknown":** the AI must pick one of your `choices`. Add an `unknown` choice yourself if the description may not answer the question, and leave it out of `expected` to exclude those jobs (or include it to keep them).
- **Stable `id`:** every answer carries the `id` you chose, so you can rename a question without breaking automations that read the answer.
- **If the AI call fails:** the job is kept, `aiStatus` is `"failed"`, and `dynamicFilterMatch` only reflects the other filters.
- **Billing:** each job the AI successfully analyses is charged one `ai-job-analysis` event (see [Pricing](#linkedin-jobs-scraper-pricing)), however many questions you ask. A job is only charged after the AI answered, so jobs with `aiStatus` `"skipped"`, `"skipped_free_plan"`, `"skipped_budget_limit"` or `"failed"` are never charged for the AI. Once your maximum charge per run is reached, the Actor stops. Jobs that were still being processed at that moment may not be saved.
- **Limits** (an invalid question stops the run before any scraping):

| Item                 | Limit                                                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Questions            | 1 to 10                                                                                                                            |
| `id`                 | Required, unique, max 40 characters (letters, numbers, `_`, `-`)                                                                   |
| `question`           | Max 200 characters                                                                                                                 |
| `choices`            | 2 to 10 lines written as `answer \| optional description`; answer max 50 characters, no duplicates; description max 200 characters |
| `expected`           | Optional, each value must be one of the answers (answer text only)                                                                 |
| Job description size | Only the first 15,000 characters are analysed                                                                                      |

#### 📊 Job Match Scoring

📺 [Watch this section explained in the tutorial video](https://www.youtube.com/watch?v=7oZorJOOa5Y\&t=997s)

> ⚠️ **This is NOT a search filter** — it does not change which jobs LinkedIn returns to you.

This is a **profile matching tool** for smarter job hunting. Paste the skills from your resume/CV here, and the scraper will automatically score every job description against your profile. Instead of reading through dozens of postings, you instantly see which jobs you're actually qualified for — and can skip the rest entirely.

| Input name       | Type                                        | Description / Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Example                                                                     |
| ---------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `resumeKeywords` | `{ keyword: string, aliases?: string[] }[]` | Array of skills from your resume/CV. Each entry requires a `keyword` and optionally `aliases` for abbreviations or alternate names. Matching is case-insensitive with smart word boundaries — `"JS"` won't match `"JSON"`, `"C++"` is handled correctly. When set, every output job gains three extra fields: `matchedKeywords` (found skills), `unmatchedKeywords` (missing skills), and `keywordMatchScorePercentage` (0–100 score, computed as `round(matched ÷ total × 100)`). | `[{ "keyword": "JavaScript", "aliases": ["JS"] }, { "keyword": "Python" }]` |

**Full example:**

```json
[
  { "keyword": "JavaScript", "aliases": ["JS"] },
  { "keyword": "Kubernetes", "aliases": ["K8s"] },
  { "keyword": "C++" },
  { "keyword": "Project Management", "aliases": ["PM"] },
  { "keyword": "Python" }
]
```

Matching is **case-insensitive** and uses **smart word boundaries** — for example, `JS` won't accidentally match `JSON`, and `C++` is handled correctly despite containing symbols.

##### 🤖 Generate Skills from Your CV Automatically

Instead of manually listing your skills, let an AI extract them from your CV and output them in the exact format above:

| LLM         | Link                                                                                                                                                                                                                                                                                                                                                                                        | Note            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| **ChatGPT** | [Open with prompt →](https://chatgpt.com/?q=Extract+skills+and+keywords+from+my+CV+for+job+matching.+Add+common+abbreviations+as+aliases.+Output+ONLY+a+raw+JSON+array+with+no+explanation+or+markdown%2C+using+this+format%3A+%5B%7B%22keyword%22%3A%22JavaScript%22%2C%22aliases%22%3A%5B%22JS%22%5D%7D%2C%7B%22keyword%22%3A%22Python%22%7D%5D.+I+will+paste+my+CV+after+this+message.)  | No login needed |
| **Claude**  | [Open with prompt →](https://claude.ai/new?q=Extract+skills+and+keywords+from+my+CV+for+job+matching.+Add+common+abbreviations+as+aliases.+Output+ONLY+a+raw+JSON+array+with+no+explanation+or+markdown%2C+using+this+format%3A+%5B%7B%22keyword%22%3A%22JavaScript%22%2C%22aliases%22%3A%5B%22JS%22%5D%7D%2C%7B%22keyword%22%3A%22Python%22%7D%5D.+I+will+paste+my+CV+after+this+message.) | Login required  |

Or copy this prompt and paste it into any LLM of your choice:

```
Extract skills and keywords from my CV for job matching. Add common abbreviations as aliases.
Output ONLY a raw JSON array with no explanation or markdown, using this format:
[{"keyword":"JavaScript","aliases":["JS"]},{"keyword":"Python"}].
I will paste my CV after this message.
```

The AI will output a JSON array — copy and paste it directly into the `resumeKeywords` field.

#### ⚙️ Run Settings

General settings that control how the scraper runs. These apply to both URL-based and keyword-based search.

📺 [Watch this section explained in the tutorial video](https://www.youtube.com/watch?v=7oZorJOOa5Y\&t=1254s)

| Input name            | Type      | Description / Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Example |
| --------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `maxItems`            | `number`  | Maximum number of job listings to scrape **across all searches in the run** (not per URL). Example: `maxItems: 500` with five search URLs gives 500 results in total, not 500 per URL. Leave empty for no limit.                                                                                                                                                                                                                                                                             | `500`   |
| `saveOnlyUniqueItems` | `boolean` | When `true`, the same LinkedIn job ID is saved only once **within a single run**, including duplicates found across different search URLs, keywords and locations. Duplicates are skipped entirely (not flagged, not fetched, not billed). Deduplication does **not** persist across separate runs: to avoid duplicates across runs, store the `jobId` values you already have and compare new results against them. Default is `false`.                                                                                                                              | `true`  |
| `enrichCompanyData`   | `boolean` | When `true`, visits each company's LinkedIn page to fetch extra fields: `companyDescription`, `companyAddress`, `companyEmployeeCount`, `companyEmployeeCountRange`, `companyWebsite`, `companyIndustry`, `companyOrganizationType`, `companyFoundedDate`, `companySpecialties`, `companyFollowersCount`, `companyOfficeLocations`, `companyAffiliatedPages`, and `companyRecentPosts`. Default is `false`. **Included at no additional charge**: it does not change the price per result, the only trade-off is a longer run time because company pages are visited. | `true`  |

#### ⚠️ Deprecated Filters

**Job Function filters (`jobFunctionInclude`, `jobFunctionExclude`) are no longer usable.** LinkedIn no longer exposes the job function, so it cannot be scraped and the output field `workType` is always empty. Do not use these two filters.

The other deprecated filters below are currently unreliable. They may or may not work depending on the search engine LinkedIn serves. When LinkedIn serves its new AI-powered search, these filters are silently ignored. They will be restored once LinkedIn supports them again. Using them will not cause any errors, but results may include jobs that do not match the filter.

| Input name           | Type       | Description / Behavior                                                                                                                                                                                                                                                                | Example           |
| -------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `salaryBase`         | `string`   | **Deprecated** - currently only works when LinkedIn serves its classic search engine; in AI-powered search LinkedIn ignores it and it cannot be verified after scraping. Minimum salary filter. Accepted values: `""` (any), `"40000"`, `"60000"`, `"80000"`, `"100000"`, `"120000"`. | `"80000"`         |
| `jobFunctionInclude` | `string[]` | **Deprecated, no longer usable.** LinkedIn no longer exposes the job function on public job pages, so it cannot be scraped (the output field `workType` is always empty). Using it flags **every** job with `dynamicFilterMatch: false`.                                              | `["Engineering"]` |
| `jobFunctionExclude` | `string[]` | **Deprecated, no longer usable.** Same reason as above: the job function cannot be scraped, so this filter has no effect (no job is ever flagged).                                                                                                                                    | `["Sales"]`       |

#### Input Sample

```json
{
  "enrichCompanyData": true,
  "keyword": ["Full Stack Developer"],
  "locations": ["Montreal, Canada"],
  "publishedAt": "r86400",
  "resumeKeywords": [
    {
      "aliases": ["TS", "JS", "JavaScript"],
      "keyword": "TypeScript"
    },
    {
      "aliases": ["Node", "NodeJS"],
      "keyword": "Node.js"
    },
    {
      "aliases": ["RN", "React Native", "Expo", "ReactJS"],
      "keyword": "React"
    },
    {
      "aliases": ["PostgreSQL"],
      "keyword": "SQL"
    },
    {
      "aliases": [
        "Git",
        "Docker",
        "Jira",
        "Postman",
        "GitHub",
        "GitLab",
        "GitHub Copilot",
        "Webpack"
      ],
      "keyword": "Tools"
    }
  ],
  "saveOnlyUniqueItems": true,
  "jobTitleExclude": ["senior", "manager", "director", "lead", "principal"]
}
```

**Note**: You can use either `startUrls` or `keyword` (with `locations`), or combine both methods in a single run.

### LinkedIn Job Data You Can Export

#### Output Fields

| Field                         | Type                                                                                                                | Description                                                                                                                                                                                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `jobId`                       | `string \| null`                                                                                                    | Unique LinkedIn job identifier.                                                                                                                                                                                                                                                                                                   |
| `jobTitle`                    | `string \| null`                                                                                                    | Job position title.                                                                                                                                                                                                                                                                                                               |
| `location`                    | `string \| null`                                                                                                    | Job location as text (e.g. `"Montreal, Quebec, Canada"`).                                                                                                                                                                                                                                                                         |
| `salaryInfo`                  | `string[]`                                                                                                          | Salary range as formatted strings (e.g. `["$69100.00", "$129200.00"]`). Empty array if not listed.                                                                                                                                                                                                                                |
| `postedTime`                  | `string \| null`                                                                                                    | Human-readable relative posted time (e.g. `"2 days ago"`).                                                                                                                                                                                                                                                                        |
| `publishedAt`                 | `string \| null`                                                                                                    | ISO 8601 date when the job was published (e.g. `"2026-06-14T00:00:00.000Z"`).                                                                                                                                                                                                                                                     |
| `searchString`                | `string \| null`                                                                                                    | The search query that found this job (e.g. `"Software Engineer - Montreal, Canada"`).                                                                                                                                                                                                                                             |
| `jobUrl`                      | `string \| null`                                                                                                    | LinkedIn job posting URL.                                                                                                                                                                                                                                                                                                         |
| `companyName`                 | `string \| null`                                                                                                    | Company name.                                                                                                                                                                                                                                                                                                                     |
| `companyUrl`                  | `string \| null`                                                                                                    | LinkedIn company page URL (not the company's own website, see `companyWebsite`).                                                                                                                                                                                                                                                  |
| `companyLogo`                 | `string \| null`                                                                                                    | Company logo image URL.                                                                                                                                                                                                                                                                                                           |
| `companyId`                   | `string \| null`                                                                                                    | LinkedIn internal company identifier.                                                                                                                                                                                                                                                                                             |
| `jobDescription`              | `string \| null`                                                                                                    | Full job description as plain text.                                                                                                                                                                                                                                                                                               |
| `applicationsCount`           | `string \| null`                                                                                                    | Number of applications received (e.g. `"Over 200 applicants"`).                                                                                                                                                                                                                                                                   |
| `contractType`                | `string \| null`                                                                                                    | Employment type (e.g. `"Full-time"`, `"Contract"`).                                                                                                                                                                                                                                                                               |
| `experienceLevel`             | `string \| null`                                                                                                    | Required experience level as listed on the posting (e.g. `"Mid-Senior level"`).                                                                                                                                                                                                                                                   |
| `yearsOfExperience`           | `{ years: string, context: string, lang: string }[]`                                                                | Structured experience requirements extracted from the job description. `years` is a normalized value (e.g. `"5+"`, `"2-5"`). Empty array if none found.                                                                                                                                                                           |
| `workType`                    | `string \| null`                                                                                                    | **Deprecated, always empty.** It used to contain the job function (e.g. `"Engineering and Information Technology"`), but LinkedIn no longer exposes it. Not related to the input `workType` filter (remote/hybrid/on-site). The Job Function dynamic filters depend on it and are deprecated too.                                 |
| `sector`                      | `string \| null`                                                                                                    | Industry sector of the job (e.g. `"Software Development"`).                                                                                                                                                                                                                                                                       |
| `applyUrl`                    | `string \| null`                                                                                                    | URL to apply for the job. May differ from `jobUrl` for Easy Apply jobs.                                                                                                                                                                                                                                                           |
| `applyType`                   | `string \| null`                                                                                                    | Application method: `"EASY_APPLY"` (apply on LinkedIn) or `"EXTERNAL"` (redirects to company site).                                                                                                                                                                                                                               |
| `posterFullName`              | `string \| null`                                                                                                    | Name of the person associated with the job posting, when LinkedIn shows one. May be a recruiter, hiring manager or another employee; it is not verified to be the hiring decision-maker. Empty string if not shown.                                                                                                               |
| `posterProfileUrl`            | `string \| null`                                                                                                    | LinkedIn profile URL of the person associated with the posting (see `posterFullName`). Empty string if not shown.                                                                                                                                                                                                                 |
| `dynamicFilterMatch`          | `boolean`                                                                                                           | `true` when no dynamic filters are configured or all configured filters passed. `false` when the job did not meet one or more filter criteria — the job is always saved regardless.                                                                                                                                               |
| `matchedKeywords`             | `string[]`                                                                                                          | Skills from `resumeKeywords` that were found in the job description. **Only present when `resumeKeywords` is set.**                                                                                                                                                                                                               |
| `unmatchedKeywords`           | `string[]`                                                                                                          | Skills from `resumeKeywords` that were NOT found in the job description. **Only present when `resumeKeywords` is set.**                                                                                                                                                                                                           |
| `keywordMatchScorePercentage` | `number \| null`                                                                                                    | Percentage of resume skills matched (0–100). Computed as `round(matched ÷ total × 100)`. **Only present when `resumeKeywords` is set.**                                                                                                                                                                                           |
| `aiStatus`                    | `string`                                                                                                            | State of the AI filter: `"answered"`, `"skipped"` (no `aiQuestions`, or the job already failed the other filters), `"skipped_free_plan"` (AI filter needs a paid plan), `"skipped_budget_limit"` (your maximum charge was reached while the job was in progress, so the AI was not run) or `"failed"` (AI call failed, job kept). |
| `aiAnswers`                   | `{ id: string, question: string, answer: string \| null, probability: number \| null, matched: boolean \| null }[]` | One entry per `aiQuestions` item, in the same order. `probability` (0–1) is how sure the AI was of its answer — a confidence signal, not guaranteed accuracy; `null` if not returned. `matched` is `null` for questions without `expected` values. Empty unless `aiStatus` is `"answered"`.                                       |
| `companyDescription`          | `string \| null`                                                                                                    | Company description from the LinkedIn About section. **Only present when `enrichCompanyData: true`**                                                                                                                                                                                                                              |
| `companyAddress`              | `object \| null`                                                                                                    | Headquarters address with fields: `streetAddress`, `addressLocality`, `addressRegion`, `postalCode`, `addressCountry`. **Only present when `enrichCompanyData: true`.**                                                                                                                                                           |
| `companyEmployeeCount`        | `number \| null`                                                                                                    | Exact employee count as shown on LinkedIn (e.g. `1019`). **Only present when `enrichCompanyData: true`.**                                                                                                                                                                                                                         |
| `companyEmployeeCountRange`   | `string \| null`                                                                                                    | Employee count range label (e.g. `"201-500 employees"`). **Only present when `enrichCompanyData: true`.**                                                                                                                                                                                                                         |
| `companyWebsite`              | `string \| null`                                                                                                    | External website of the company, as listed on its LinkedIn company profile (unlike `companyUrl`, which is the LinkedIn page). Empty if the company has not provided one. **Only present when `enrichCompanyData: true`.**                                                                                                         |
| `companyIndustry`             | `string \| null`                                                                                                    | Industry category from the LinkedIn About section (e.g. `"Software Development"`). **Only present when `enrichCompanyData: true`.**                                                                                                                                                                                               |
| `companyOrganizationType`     | `string \| null`                                                                                                    | Organisation type (e.g. `"Privately Held"`, `"Public Company"`). **Only present when `enrichCompanyData: true`.**                                                                                                                                                                                                                 |
| `companyFoundedDate`          | `string \| null`                                                                                                    | Year the company was founded (e.g. `"2019"`). **Only present when `enrichCompanyData: true`.**                                                                                                                                                                                                                                    |
| `companySpecialties`          | `string[]`                                                                                                          | List of company specialties from the About section. **Only present when `enrichCompanyData: true`.**                                                                                                                                                                                                                              |
| `companyFollowersCount`       | `number \| null`                                                                                                    | Number of LinkedIn followers the company has. **Only present when `enrichCompanyData: true`.**                                                                                                                                                                                                                                    |
| `companyOfficeLocations`      | `string[]`                                                                                                          | List of office address strings from the company page. **Only present when `enrichCompanyData: true`.**                                                                                                                                                                                                                            |
| `companyAffiliatedPages`      | `string[]`                                                                                                          | Names of affiliated LinkedIn company pages. **Only present when `enrichCompanyData: true`.**                                                                                                                                                                                                                                      |
| `companyRecentPosts`          | `{ text: string, datePublished: string, url: string }[]`                                                            | Recent posts published by the company on LinkedIn. `datePublished` is ISO 8601. **Only present when `enrichCompanyData: true`.**                                                                                                                                                                                                  |

```json
[
  {
    "jobId": "4354494117",
    "jobTitle": "Full-Stack Software Engineer, Inference",
    "location": "Montreal, Quebec, Canada",
    "salaryInfo": [],
    "postedTime": "6 hours ago",
    "publishedAt": "2026-06-14T00:00:00.000Z",
    "searchString": "Full Stack Developer - Montreal, Canada",
    "jobUrl": "https://ca.linkedin.com/jobs/view/full-stack-software-engineer-inference-at-cohere-4354494117?trk=public_jobs_topcard-title",
    "companyName": "Cohere",
    "companyUrl": "https://ca.linkedin.com/company/cohere-ai?trk=public_jobs_topcard-org-name",
    "companyLogo": "https://media.licdn.com/dms/image/v2/C560BAQGI_GYoDekJsQ/company-logo_200_200/company-logo_200_200/0/1680024442682/cohere_ai_logo?e=2147483647&v=beta&t=YjvCYqodFatkvEoqaggfjwCzFvzvDUFjIo5zpvlogxk",
    "jobDescription": "Who are we?\n\nCohere is the leading security-first enterprise AI company. We build cutting-edge foundation AI models and end-to-end products that are designed to solve real-world business problems.\n\nWe’re training and deploying frontier models for enterprises who are building AI systems. We believe that our work is instrumental to the widespread adoption of AI and we are looking for folks that want to be part of that.\n\nWe obsess over what we build. Each one of us is responsible for contributing to increasing the capabilities of our models and the value they drive for our customers. Cohere is a team of researchers, engineers, designers, and more, who are all passionate about their craft.\n\nWe are a global technology company co-headquartered in Toronto and San Francisco, with key offices in London, New York City, Montreal, Seoul, Germany and Paris. Join us!\n\nWhy this role?\n\nCohere customers self-serve our API without any intervention. This team unlocks the complex technology we build for customers to understand, trust, and pay for.\n\nAs a Senior Software Engineer, You Will\n\nImprove the platform’s auth, billing, and payment systems\nAdd new features to the interactive Playground where customers can try our models\nImplement new platform features for managing deployments\nWrite and ship minimal code that runs in low-resource environments, and has highly stringent deployment mechanisms\nAs security and privacy are paramount, you will sometimes need to reinvent the wheel, and won’t be able to use the most popular libraries or tooling\n\nYou May Be a Good Fit If\n\nYou have 5+ years of experience writing clean backend code. Our stack includes: Golang and React.\nYou’ve built payment systems and have experience with subscription or usage-based SaaS, and/or products with a freemium model.\nYou have strong coding abilities and are comfortable working across the stack. You’re able to read and understand, and even fix issues outside of the main code base.\nYou’ve worked in both large enterprises and startups.\nYou excel in fast-paced environments and can execute while priorities and objectives are a moving target.\n\nHow And Where We Work\n\nCohere is remote-friendly. We have offices in Toronto, San Francisco, New York City, London, Paris, Montreal, and more coming soon.\nFor those in the office: a daily lunch program, plenty of snacks, and regular community and social events.\nFor those not near an office: a co-working benefit so you can work alongside others in your city.\n\nIf any of the above doesn’t line up exactly with your experience, we still encourage you to apply.\n\nWe strive to create an inclusive work environment for all; we welcome applicants from all backgrounds and are committed to providing equal opportunities. Should you require any accommodations during the recruitment process, please submit an Accommodations Request Form, and we will work together to meet your needs.\n\nWe may use AI-enabled tools to screen and assess applicants against the criteria for this position. This helps our recruiters identify potentially qualified candidates, but it doesn't limit the applications our recruiters may review or consider. \nShow more Show less",
    "applicationsCount": "Over 200 applicants",
    "contractType": "Full-time",
    "experienceLevel": "Not Applicable",
    "yearsOfExperience": [
      {
        "years": "5+",
        "context": "writing clean backend code",
        "lang": "en"
      }
    ],
    "workType": "",
    "sector": "Software Development",
    "posterFullName": "",
    "posterProfileUrl": "",
    "companyId": "24024765",
    "applyUrl": "https://ca.linkedin.com/jobs/view/full-stack-software-engineer-inference-at-cohere-4354494117?trk=public_jobs_topcard-title",
    "applyType": "EXTERNAL",
    "dynamicFilterMatch": true,
    "matchedKeywords": [
      "React",
      "Tools"
    ],
    "unmatchedKeywords": [
      "TypeScript",
      "Node.js",
      "SQL"
    ],
    "keywordMatchScorePercentage": 40
  },
  ...
]
```

#### With `enrichCompanyData: true`

When you enable `enrichCompanyData`, each result gets the following additional fields fetched from the company's LinkedIn page:

```json
{
 "companyAddress": {
		"streetAddress": "171 John St",
		"addressLocality": "Toronto",
		"addressRegion": "Ontario",
		"postalCode": "M5T 1X3",
		"addressCountry": "CA"
	},
	"companyDescription": "Cohere is the leading security-first enterprise AI company. We build cutting-edge foundation models and end-to-end AI products designed to solve real-world business problems. We partner closely with companies to deliver seamless integration, full customization, and easy-to-use solutions for their workforce and customers. Our all-in-one platform offers enterprises the highest levels of data security, privacy and optionality to deploy across all major cloud providers, private cloud environments, or on-premises. \n\nHQ: 171 John Street, 2nd Floor, Toronto, ON M5T 1X3",
	"companyEmployeeCount": 1019,
	"companyWebsite": "https://cohere.com",
	"companyIndustry": "Software Development",
	"companyEmployeeCountRange": "201-500 employees",
	"companyOrganizationType": "Privately Held",
	"companyFoundedDate": "2019",
	"companySpecialties": [
		"Natural Language Processing",
		"Machine Learning",
		"and Artificial Intelligence"
	],
	"companyFollowersCount": 253257,
	"companyOfficeLocations": [
		"171 John St 2nd Floor Toronto, Ontario M5T 1X3, CA",
		"San Francisco, California, US",
		"London, GB",
		"New York, NY, US",
		"Paris, FR",
		"Montreal, CA",
		"Seoul , KR"
	],
	"companyAffiliatedPages": [
		"Cohere Labs"
	],
	"companyRecentPosts": [
		{
			"text": "Four days ago, Cohere co-founder Nick Frosst warned about the dangers of subscriptions to proprietary LLMs on MTS Live:\n\n\"We released [North Mini Code] because we think this technology needs to be sovereign. It needs to be owned, and controlled, by the people who use it.\"",
			"datePublished": "2026-06-14T20:13:09.311Z",
			"url": "https://www.linkedin.com/posts/cohere-ai_nick-frosst-on-mts-live-activity-7472018313511092224-7lKZ"
		},
		{
			"text": "When you rent your artificial intelligence, you have no control, and no choice. This is why sovereignty and ownership matters. \n\nWhether it means using your own hardware, open source, or deep customization. Own your AI, own your future.",
			"datePublished": "2026-06-13T15:49:47.946Z",
			"url": "https://www.linkedin.com/posts/cohere-ai_when-you-rent-your-artificial-intelligence-activity-7471589649916887040-61hN"
		},
    ...
	]
}
```

### LinkedIn Jobs Workflows & Integrations

#### Collecting 3,000+ unique jobs in one run

Each search returns at most 1,000 jobs, so use several different searches in one run:

```json
{
  "keyword": ["Backend Developer", "Software Engineer"],
  "locations": ["Toronto, Canada", "Montreal, Canada", "Vancouver, Canada"],
  "publishedAt": "r2592000",
  "saveOnlyUniqueItems": true,
  "maxItems": 5000
}
```

This creates 6 searches (2 keywords × 3 locations). Set `maxItems` high enough for the total you want.

#### Avoid duplicates across runs (Make.com / n8n / Zapier)

`saveOnlyUniqueItems` only works inside one run. To avoid duplicates between scheduled runs:

1. **Apify** – Get Dataset Items
2. **Filter** – keep only `dynamicFilterMatch = true` (if you use dynamic filters)
3. **Google Sheets / database** – search for the row where `jobId` equals the job's `jobId`
4. **If not found** – add a new row

#### Lead generation & decision-maker enrichment

The actor provides job and company data. It does **not** identify or verify decision-makers and does **not** find contact emails. For lead generation, send these fields to your own downstream enrichment service: `jobTitle`, `jobDescription`, `companyName`, `companyId`, `companyWebsite` (needs `enrichCompanyData: true`) and, when available, `posterFullName` / `posterProfileUrl`. Finding emails requires a separate service.

### Check out my other Products

#### Scrapers

- [Indeed Job Scraper](https://apify.com/cheap_scraper/indeed-job-scraper)
- [Glassdoor Job Scraper](https://apify.com/cheap_scraper/glassdoor-jobs-scraper-remove-duplicate-jobs)

# Changelog

This Actor's version history is a separate document: https://apify.com/cheap_scraper/linkedin-job-scraper/changelog.md

# Actor input Schema

## `startUrls` (type: `array`):

One or more URLs of the pages where the crawler will start. Note that the Actor will additionally crawl job page data.

## `keyword` (type: `array`):

Keyword to search for. (e.g., Software Engineer)

## `locations` (type: `array`):

One or more locations to search in (e.g. Montreal, Canada). Each location is combined with every keyword to generate one search per pair. When set alongside the legacy Location field, both are merged.

## `location` (type: `string`):

Single location to search in. Use the Locations field instead to search multiple locations at once.

## `distance` (type: `string`):

Search radius from the location in miles. Leave empty for default.

## `publishedAt` (type: `string`):

How old publications should be in Days. Default is ANY.

## `jobType` (type: `array`):

Filter by job type (Full-time, Part-time, Contract, etc.). Multiple selections allowed. When LinkedIn serves its classic search engine this filter works normally. When LinkedIn serves its AI search engine the filter is ignored, so the scraper instead embeds it into the search query itself, which the AI search understands: the search is retried once with e.g. 'Full-time <keyword>' for a single selection or '(Full-time OR Contract) <keyword>' for multiple selections.

## `experienceLevel` (type: `array`):

Filter by experience level. Multiple selections allowed. When LinkedIn serves its classic search engine this filter works normally. When LinkedIn serves its AI search engine the filter is ignored, so the scraper instead embeds it into the search query itself, which the AI search understands: the search is retried once with e.g. 'Entry level <keyword>' for a single selection or '(Entry level OR Associate) <keyword>' for multiple selections.

## `workType` (type: `array`):

Filter by work location type (On-site, Remote, Hybrid). Multiple selections allowed. When LinkedIn serves its classic search engine this filter works normally. When LinkedIn serves its AI search engine the filter is ignored by LinkedIn and job pages have no field to verify it, so the scraper instead embeds the work type into the search query itself, which the AI search understands: the search is retried once with e.g. 'Remote <keyword>' for a single selection or '(Remote OR "On-Site") <keyword>' for multiple selections.

## `companyInclude` (type: `array`):

Restrict the search to specific companies. Add one company name per entry (e.g. Google, Shopify). Each name is resolved to a LinkedIn company ID and added to the search URL — LinkedIn will only return jobs from those companies.

If a name cannot be matched, it is silently skipped.

## `filterUnder10Applicants` (type: `boolean`):

When enabled, LinkedIn will only return jobs with fewer than 10 applicants. Appends `f_EA=true` to the search URL. Keyword-based search only — does not affect URL-based search.

## `filterEasyApply` (type: `boolean`):

When enabled, LinkedIn will only return jobs that support Easy Apply (apply directly on LinkedIn without leaving the site). Appends `f_AL=true` to the search URL. Keyword-based search only — does not affect URL-based search.

## `subLocationExclude` (type: `array`):

Exclude jobs from specific cities or areas. Add each city name as a separate entry — any job whose location contains that name will be skipped (e.g. add "Laval" to exclude all jobs in Laval). Works independently of the Locations field. Also works with URL-based search.

## `companyExclude` (type: `array`):

Skip jobs from specific companies. Add one company name per entry — any job whose company name exactly matches (case-insensitive) will not be collected. Works for both keyword-based and URL-based searches.

## `jobTitleExclude` (type: `array`):

Skip jobs whose title contains any of these keywords (whole-word, case-insensitive). For example, entering "senior" will exclude "Senior Software Engineer" but not "seniority". Works for both keyword-based and URL-based searches.

## `jobIndustryInclude` (type: `array`):

Only keep jobs where the **industry** matches one of the selected values.

**Note:** This takes priority over **Exclude Industries** when both are set.

Jobs are still collected and counted toward billing. Use `dynamicFilterMatch` to filter them in your results. Non-matching jobs are saved with `dynamicFilterMatch: false`.

Find all LinkedIn industries here: [LinkedIn Industry Codes](https://learn.microsoft.com/en-us/linkedin/shared/references/reference-tables/industry-codes-v2)

## `jobIndustryExclude` (type: `array`):

Exclude jobs whose **industry** matches any of the selected values. Only applies when "Include Industries" is not set.

Jobs are still collected and counted toward your billing — use `dynamicFilterMatch` to filter them out in your results. You can find all the Linkedin industries at [LinkedIn Industry Codes](https://learn.microsoft.com/en-us/linkedin/shared/references/reference-tables/industry-codes-v2)

## `excludeRecruitingAgencies` (type: `boolean`):

When enabled, jobs posted by staffing and recruiting agencies will be flagged with `dynamicFilterMatch: false`. Jobs are still collected and counted toward your billing — use `dynamicFilterMatch` to filter them out in your results.\`

## `companySizeMin` (type: `integer`):

Only keep jobs from companies with at least this many employees. Jobs that do not match are still collected and counted toward your billing — use `dynamicFilterMatch` to filter them out.

## `companySizeMax` (type: `integer`):

Only keep jobs from companies with at most this many employees. Jobs that do not match are still collected and counted toward your billing — use `dynamicFilterMatch` to filter them out.

## `companyOrganizationTypeInclude` (type: `array`):

Only keep jobs from companies whose LinkedIn company page organization type matches one of the selected values. Takes priority over "Exclude Company Organization Types" when both are set.

Jobs are still collected and counted toward your billing — use `dynamicFilterMatch` to filter them out in your results. Non-matching jobs are saved with `dynamicFilterMatch: false`.

Full list of organization types at [LinkedIn Company Profile](https://learn.microsoft.com/en-us/linkedin/shared/references/fields/company-profile)

## `companyOrganizationTypeExclude` (type: `array`):

Flag jobs from companies whose LinkedIn company page organization type matches any of the selected values as `dynamicFilterMatch: false`. Only applies when "Include Company Organization Types" is not set. Jobs are still collected and counted toward your billing — use `dynamicFilterMatch` to filter them out in your results.

Full list of organization types at [LinkedIn Company Profile](https://learn.microsoft.com/en-us/linkedin/shared/references/fields/company-profile)

## `companyFoundedDateMin` (type: `integer`):

Only keep jobs from companies founded in or after this year. Jobs from companies whose founding year is not available always pass.

Jobs are still collected and counted toward your billing — use `dynamicFilterMatch` to filter them out in your results.

## `companyFoundedDateMax` (type: `integer`):

Only keep jobs from companies founded in or before this year. Jobs from companies whose founding year is not available always pass.

Jobs are still collected and counted toward your billing — use `dynamicFilterMatch` to filter them out in your results.

## `companyFollowersCountMin` (type: `integer`):

Only keep jobs from companies with at least this many LinkedIn followers. Jobs from companies whose follower count is not available always pass.

Jobs are still collected and counted toward your billing — use `dynamicFilterMatch` to filter them out in your results.

## `companyFollowersCountMax` (type: `integer`):

Only keep jobs from companies with at most this many LinkedIn followers. Jobs from companies whose follower count is not available always pass.

Jobs are still collected and counted toward your billing — use `dynamicFilterMatch` to filter them out in your results.

## `requireRecruiterProfile` (type: `boolean`):

When enabled, only jobs that have a recruiter profile associated with the posting will have `dynamicFilterMatch: true`. Jobs without a recruiter profile are still collected and billed — use `dynamicFilterMatch` to filter them out.

## `requireSalaryInfo` (type: `boolean`):

When enabled, only jobs that include salary information in the posting will have `dynamicFilterMatch: true`. Jobs without salary info are still collected and billed — use `dynamicFilterMatch` to filter them out.

## `useAiJobDescriptionParsing` (type: `boolean`):

⚠️ Premium users only. When enabled, the AI answers the questions below for every job that passed the other dynamic filters, and each analysed job is billed with the `ai-job-analysis` event. When disabled (default), the questions are ignored and no AI is used.

## `aiQuestions` (type: `array`):

⚠️ Premium users only — used only when **Use AI Job Description Parsing** is enabled. Add up to 10 multiple-choice questions asked about each job description. Each question has an ID, the question, its answer choices and optional expected answers. Questions without expected answers only add information to the output.

**How it works**

- The AI runs only on jobs that passed every other dynamic filter, so you are only charged for those.
- The AI must pick one of your answer choices — add something like `unknown` yourself if the description may not answer the question.
- Write each answer choice on its own line as `answer | optional description`. The description helps the AI tell similar options apart (e.g. `Remote | Work fully from home`). Without a `|`, there is no description. An answer itself cannot contain `|`.
- Expected answers list the answer texts (the part before the `|`) that keep the job matching; any other answer sets `dynamicFilterMatch` to false.
- Every job gets `aiStatus` and `aiAnswers` (each answer carries your question `id`, the `probability` of the answer and whether it `matched` your expected answers).
- Only the first 15,000 characters of each description are analysed.

**Limits:** ID up to 40 characters (letters, numbers, `_`, `-`, unique); question up to 200 characters; 2 to 10 answer choices with an answer of up to 50 characters and an optional description of up to 200 characters. Invalid questions stop the run before any scraping.

## `resumeKeywords` (type: `array`):

Each entry has a required `keyword` and optional `aliases` for abbreviations (e.g. `JavaScript` → `JS`). Each job in the output will include `matchedKeywords`, `unmatchedKeywords`, and `keywordMatchScorePercentage` (0–100).

## `maxItems` (type: `integer`):

Maximum number of job listings to scrape. Leave empty for no limit.

## `saveOnlyUniqueItems` (type: `boolean`):

If enabled, only unique items will be saved. Default is false.

## `enrichCompanyData` (type: `boolean`):

When disabled, the scraper runs significantly faster by skipping additional company page requests. When enabled, the scraper fetches extra company details including: company description, full address (street, city, region, postal code, country), employee count, and company website. Default is disabled for optimal performance.

## `salaryBase` (type: `string`):

Filter by minimum salary. Only one value allowed. 🛠️ In maintenance: this filter currently only works when LinkedIn serves its classic search engine. When LinkedIn serves its new AI-powered search, it silently ignores this filter, and since salary cannot be verified reliably from job postings, the scraper has no workaround - results will include jobs below this salary. It will be restored once LinkedIn supports it again.

## `jobFunctionInclude` (type: `array`):

⚠️ **Deprecated, no longer available:** LinkedIn no longer exposes the job function on public job pages, so the scraper cannot read it anymore (the output field `workType` is empty). Using it flags every job with `dynamicFilterMatch: false`. Do not use it. Only keep jobs where the **job function** matches one of the selected values.

**Note:** This takes priority over **Exclude Job Functions** when both are set.

Jobs are still collected and counted toward billing. Use `dynamicFilterMatch` to filter them in your results. Non-matching jobs are saved with `dynamicFilterMatch: false`.

Applies to both URL-based and keyword-based searches.

Find all LinkedIn job functions here: [LinkedIn Job Function Codes](https://learn.microsoft.com/en-us/linkedin/shared/references/reference-tables/job-function-codes)

## `jobFunctionExclude` (type: `array`):

⚠️ **Deprecated, no longer available:** LinkedIn no longer exposes the job function on public job pages, so the scraper cannot read it anymore (the output field `workType` is empty). Using it has no effect (no job is ever excluded). Do not use it. Exclude jobs whose **job function** matches any of the selected values. Only applies when "Include Job Functions" is not set.

Jobs are still collected and counted toward your billing — use `dynamicFilterMatch` to filter them out in your results. Non-matching jobs are saved with `dynamicFilterMatch: false`.

Find all LinkedIn job functions here: [LinkedIn Job Function Codes](https://learn.microsoft.com/en-us/linkedin/shared/references/reference-tables/job-function-codes)

## Actor input object example

```json
{
  "startUrls": [
    {
      "url": "https://www.linkedin.com/jobs/search/?f_TPR=r604800&geoId=100025096&keywords=data+scientist"
    }
  ],
  "keyword": [
    "Software Engineer"
  ],
  "locations": [
    "Montreal, Canada"
  ],
  "distance": "",
  "publishedAt": "r86400",
  "filterUnder10Applicants": false,
  "filterEasyApply": false,
  "excludeRecruitingAgencies": false,
  "requireRecruiterProfile": false,
  "requireSalaryInfo": false,
  "useAiJobDescriptionParsing": false,
  "aiQuestions": [
    {
      "id": "workModel",
      "question": "Is this job remote, hybrid or on site?",
      "choices": [
        "remote | Work fully from home",
        "hybrid | Mix of office and home",
        "on-site | Work fully at the employer's location",
        "unknown | The description does not say"
      ],
      "expected": [
        "remote",
        "hybrid"
      ]
    },
    {
      "id": "visaSponsorship",
      "question": "Does the employer offer visa sponsorship?",
      "choices": [
        "yes | The description says visa sponsorship or work permit support is offered",
        "no | The description says sponsorship is not offered or work authorization is required",
        "unknown | The description does not mention it"
      ],
      "expected": [
        "yes"
      ]
    },
    {
      "id": "language",
      "question": "Which languages must the candidate speak?",
      "choices": [
        "english only",
        "french only",
        "english and french | Fluency in both languages is required",
        "other | Any other language requirement",
        "unknown | The description does not say"
      ]
    }
  ],
  "resumeKeywords": [
    {
      "keyword": "TypeScript",
      "aliases": [
        "TS",
        "JS",
        "JavaScript"
      ]
    },
    {
      "keyword": "Node.js",
      "aliases": [
        "Node",
        "NodeJS"
      ]
    },
    {
      "keyword": "React",
      "aliases": [
        "RN",
        "React Native",
        "Expo",
        "ReactJS"
      ]
    },
    {
      "keyword": "SQL",
      "aliases": [
        "PostgreSQL"
      ]
    },
    {
      "keyword": "Tools",
      "aliases": [
        "Git",
        "Docker",
        "Jira",
        "Postman",
        "GitHub",
        "GitLab",
        "GitHub Copilot",
        "Webpack"
      ]
    }
  ],
  "saveOnlyUniqueItems": false,
  "enrichCompanyData": false
}
```

# Actor output Schema

## `overview` (type: `string`):

No description

## `companyDetails` (type: `string`):

No description

## `profileMatch` (type: `string`):

No description

# API

You can run this Actor programmatically using our API. Below are code examples in JavaScript, Python, and CLI, as well as the OpenAPI specification and MCP server setup.

## JavaScript example

```javascript
import { ApifyClient } from 'apify-client';

// Initialize the ApifyClient with your Apify API token
// Replace the '<YOUR_API_TOKEN>' with your token
const client = new ApifyClient({
    token: '<YOUR_API_TOKEN>',
});

// Prepare Actor input
const input = {
    "startUrls": [
        {
            "url": "https://www.linkedin.com/jobs/search/?f_TPR=r604800&geoId=100025096&keywords=data+scientist"
        }
    ],
    "keyword": [
        "Software Engineer"
    ],
    "locations": [
        "Montreal, Canada"
    ],
    "publishedAt": "r86400",
    "aiQuestions": [
        {
            "id": "workModel",
            "question": "Is this job remote, hybrid or on site?",
            "choices": [
                "remote | Work fully from home",
                "hybrid | Mix of office and home",
                "on-site | Work fully at the employer's location",
                "unknown | The description does not say"
            ],
            "expected": [
                "remote",
                "hybrid"
            ]
        },
        {
            "id": "visaSponsorship",
            "question": "Does the employer offer visa sponsorship?",
            "choices": [
                "yes | The description says visa sponsorship or work permit support is offered",
                "no | The description says sponsorship is not offered or work authorization is required",
                "unknown | The description does not mention it"
            ],
            "expected": [
                "yes"
            ]
        },
        {
            "id": "language",
            "question": "Which languages must the candidate speak?",
            "choices": [
                "english only",
                "french only",
                "english and french | Fluency in both languages is required",
                "other | Any other language requirement",
                "unknown | The description does not say"
            ]
        }
    ],
    "resumeKeywords": [
        {
            "keyword": "TypeScript",
            "aliases": [
                "TS",
                "JS",
                "JavaScript"
            ]
        },
        {
            "keyword": "Node.js",
            "aliases": [
                "Node",
                "NodeJS"
            ]
        },
        {
            "keyword": "React",
            "aliases": [
                "RN",
                "React Native",
                "Expo",
                "ReactJS"
            ]
        },
        {
            "keyword": "SQL",
            "aliases": [
                "PostgreSQL"
            ]
        },
        {
            "keyword": "Tools",
            "aliases": [
                "Git",
                "Docker",
                "Jira",
                "Postman",
                "GitHub",
                "GitLab",
                "GitHub Copilot",
                "Webpack"
            ]
        }
    ]
};

// Run the Actor and wait for it to finish
const run = await client.actor("cheap_scraper/linkedin-job-scraper").call(input);

// Fetch and print Actor results from the run's dataset (if any)
console.log('Results from dataset');
console.log(`💾 Check your data here: https://console.apify.com/storage/datasets/${run.defaultDatasetId}`);
const { items } = await client.dataset(run.defaultDatasetId).listItems();
items.forEach((item) => {
    console.dir(item);
});

// 📚 Want to learn more 📖? Go to → https://docs.apify.com/api/client/js/docs

```

## Python example

```python
from apify_client import ApifyClient

# Initialize the ApifyClient with your Apify API token
# Replace '<YOUR_API_TOKEN>' with your token.
client = ApifyClient("<YOUR_API_TOKEN>")

# Prepare the Actor input
run_input = {
    "startUrls": [{ "url": "https://www.linkedin.com/jobs/search/?f_TPR=r604800&geoId=100025096&keywords=data+scientist" }],
    "keyword": ["Software Engineer"],
    "locations": ["Montreal, Canada"],
    "publishedAt": "r86400",
    "aiQuestions": [
        {
            "id": "workModel",
            "question": "Is this job remote, hybrid or on site?",
            "choices": [
                "remote | Work fully from home",
                "hybrid | Mix of office and home",
                "on-site | Work fully at the employer's location",
                "unknown | The description does not say",
            ],
            "expected": [
                "remote",
                "hybrid",
            ],
        },
        {
            "id": "visaSponsorship",
            "question": "Does the employer offer visa sponsorship?",
            "choices": [
                "yes | The description says visa sponsorship or work permit support is offered",
                "no | The description says sponsorship is not offered or work authorization is required",
                "unknown | The description does not mention it",
            ],
            "expected": ["yes"],
        },
        {
            "id": "language",
            "question": "Which languages must the candidate speak?",
            "choices": [
                "english only",
                "french only",
                "english and french | Fluency in both languages is required",
                "other | Any other language requirement",
                "unknown | The description does not say",
            ],
        },
    ],
    "resumeKeywords": [
        {
            "keyword": "TypeScript",
            "aliases": [
                "TS",
                "JS",
                "JavaScript",
            ],
        },
        {
            "keyword": "Node.js",
            "aliases": [
                "Node",
                "NodeJS",
            ],
        },
        {
            "keyword": "React",
            "aliases": [
                "RN",
                "React Native",
                "Expo",
                "ReactJS",
            ],
        },
        {
            "keyword": "SQL",
            "aliases": ["PostgreSQL"],
        },
        {
            "keyword": "Tools",
            "aliases": [
                "Git",
                "Docker",
                "Jira",
                "Postman",
                "GitHub",
                "GitLab",
                "GitHub Copilot",
                "Webpack",
            ],
        },
    ],
}

# Run the Actor and wait for it to finish
run = client.actor("cheap_scraper/linkedin-job-scraper").call(run_input=run_input)

# Fetch and print Actor results from the run's dataset (if there are any)
print(f"💾 Check your data here: https://console.apify.com/storage/datasets/{run.default_dataset_id}")
for item in client.dataset(run.default_dataset_id).iterate_items():
    print(item)

# 📚 Want to learn more 📖? Go to → https://docs.apify.com/api/client/python/docs/quick-start

```

## CLI example

```bash
echo '{
  "startUrls": [
    {
      "url": "https://www.linkedin.com/jobs/search/?f_TPR=r604800&geoId=100025096&keywords=data+scientist"
    }
  ],
  "keyword": [
    "Software Engineer"
  ],
  "locations": [
    "Montreal, Canada"
  ],
  "publishedAt": "r86400",
  "aiQuestions": [
    {
      "id": "workModel",
      "question": "Is this job remote, hybrid or on site?",
      "choices": [
        "remote | Work fully from home",
        "hybrid | Mix of office and home",
        "on-site | Work fully at the employer'\''s location",
        "unknown | The description does not say"
      ],
      "expected": [
        "remote",
        "hybrid"
      ]
    },
    {
      "id": "visaSponsorship",
      "question": "Does the employer offer visa sponsorship?",
      "choices": [
        "yes | The description says visa sponsorship or work permit support is offered",
        "no | The description says sponsorship is not offered or work authorization is required",
        "unknown | The description does not mention it"
      ],
      "expected": [
        "yes"
      ]
    },
    {
      "id": "language",
      "question": "Which languages must the candidate speak?",
      "choices": [
        "english only",
        "french only",
        "english and french | Fluency in both languages is required",
        "other | Any other language requirement",
        "unknown | The description does not say"
      ]
    }
  ],
  "resumeKeywords": [
    {
      "keyword": "TypeScript",
      "aliases": [
        "TS",
        "JS",
        "JavaScript"
      ]
    },
    {
      "keyword": "Node.js",
      "aliases": [
        "Node",
        "NodeJS"
      ]
    },
    {
      "keyword": "React",
      "aliases": [
        "RN",
        "React Native",
        "Expo",
        "ReactJS"
      ]
    },
    {
      "keyword": "SQL",
      "aliases": [
        "PostgreSQL"
      ]
    },
    {
      "keyword": "Tools",
      "aliases": [
        "Git",
        "Docker",
        "Jira",
        "Postman",
        "GitHub",
        "GitLab",
        "GitHub Copilot",
        "Webpack"
      ]
    }
  ]
}' |
apify call cheap_scraper/linkedin-job-scraper --silent --output-dataset

```

## MCP server setup

```json
{
    "mcpServers": {
        "apify": {
            "type": "http",
            "url": "https://mcp.apify.com/?tools=fetch-actor-details,cheap_scraper/linkedin-job-scraper"
        }
    }
}
```

The hosted server signs you in with OAuth on first connect, so no API token belongs in this config. Clients without OAuth support can send an `Authorization: Bearer <APIFY_API_TOKEN>` header instead, using a token from API & Integrations in Apify Console (https://console.apify.com/settings/integrations).

## OpenAPI specification

Download the OpenAPI definition: https://api.apify.com/v2/actors/2rJKkhh7vjpX7pvjg/builds/7ZFx4GK5r9sDle4gE/openapi.json
