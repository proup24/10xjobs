import { Arrangement, Seniority } from 'src/common/enums';

/** Search phrases per position: 1-3 lowercase phrases, the canonical title first. */
export const POSITION_TITLES: Readonly<Record<string, readonly string[]>> = {
  backend_engineer: [
    'backend engineer',
    'backend developer',
    'backend software engineer',
  ],
  frontend_engineer: [
    'frontend engineer',
    'frontend developer',
    'front end engineer',
  ],
  fullstack_engineer: [
    'fullstack engineer',
    'full stack engineer',
    'full stack developer',
  ],
  mobile_engineer: [
    'mobile engineer',
    'mobile developer',
    'mobile app developer',
  ],
  devops_engineer: ['devops engineer', 'devops'],
  site_reliability_engineer: ['site reliability engineer', 'sre'],
  platform_engineer: ['platform engineer', 'infrastructure engineer'],
  cloud_engineer: ['cloud engineer', 'cloud infrastructure engineer'],
  security_engineer: ['security engineer', 'application security engineer'],
  data_engineer: ['data engineer', 'data platform engineer'],
  ml_engineer: ['machine learning engineer', 'ml engineer', 'mlops engineer'],
  ai_engineer: ['ai engineer', 'llm engineer', 'applied ai engineer'],
  qa_engineer: [
    'qa engineer',
    'software engineer in test',
    'test automation engineer',
  ],
  embedded_engineer: [
    'embedded engineer',
    'embedded software engineer',
    'firmware engineer',
  ],
  software_architect: ['software architect', 'technical architect'],
  tech_lead: ['tech lead', 'technical lead', 'engineering lead'],
  engineering_manager: ['engineering manager', 'software engineering manager'],
  ai_training: ['ai trainer', 'ai training', 'ai tutor'],
};

/** Seniority word added to a title query; `unstated` adds nothing. */
export const SENIORITY_WORDS: Readonly<Record<string, string | null>> = {
  [Seniority.junior]: 'junior',
  [Seniority.mid]: 'mid-level',
  [Seniority.senior]: 'senior',
  [Seniority.staff]: 'staff',
  [Seniority.lead]: 'lead',
  [Seniority.principal]: 'principal',
  [Seniority.unstated]: null,
};

/** Work arrangement word added to a query; `unstated` adds nothing. */
export const ARRANGEMENT_WORDS: Record<Arrangement, string | null> = {
  [Arrangement.remote]: 'remote',
  [Arrangement.hybrid]: 'hybrid',
  [Arrangement.onsite]: 'on-site',
  [Arrangement.unstated]: null,
};

export { TECHNOLOGY_TERMS } from '@xjobs/database/enums';
