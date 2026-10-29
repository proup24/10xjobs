/**
 * @description Value lists for the profile enums in the data contract
 * (`src/database/contract.prisma`). DTOs validate against these; the spec
 * beside this file fails when they drift from the contract.
 */
export const POSITIONS = [
  'backend_engineer',
  'frontend_engineer',
  'fullstack_engineer',
  'mobile_engineer',
  'devops_engineer',
  'site_reliability_engineer',
  'platform_engineer',
  'cloud_engineer',
  'security_engineer',
  'data_engineer',
  'ml_engineer',
  'ai_engineer',
  'qa_engineer',
  'embedded_engineer',
  'software_architect',
  'tech_lead',
  'engineering_manager',
] as const;
export type Position = (typeof POSITIONS)[number];

export const LANGUAGES = ['AR', 'FR', 'EN', 'ES'] as const;
export type Language = (typeof LANGUAGES)[number];

export const REGIONS = [
  'EMEA',
  'MENA',
  'NORTH_AFRICA',
  'SUB_SAHARAN_AFRICA',
  'MIDDLE_EAST',
  'EUROPE',
  'EU',
  'UK',
  'NORTH_AMERICA',
  'LATAM',
  'APAC',
  'GLOBAL',
] as const;
export type Region = (typeof REGIONS)[number];

export const ENGAGEMENTS = [
  'employee',
  'contractor',
  'eor',
  'agency',
  'per_task',
] as const;
export type Engagement = (typeof ENGAGEMENTS)[number];

export const ARRANGEMENTS = ['remote', 'hybrid', 'onsite', 'unstated'] as const;
export type Arrangement = (typeof ARRANGEMENTS)[number];

export const SENIORITIES = [
  'junior',
  'mid',
  'senior',
  'staff',
  'lead',
  'principal',
  'unstated',
] as const;
export type Seniority = (typeof SENIORITIES)[number];

export const CONTACT_KINDS = [
  'phone',
  'email',
  'linkedin',
  'github',
  'gitlab',
  'portfolio',
  'website',
  'other',
] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

export const SKILL_DOMAINS = [
  'backend',
  'frontend',
  'fullstack',
  'mobile',
  'devops',
  'data',
  'ml',
  'security',
  'qa',
] as const;
export type SkillDomain = (typeof SKILL_DOMAINS)[number];

export const TECHNOLOGIES = [
  'javascript',
  'typescript',
  'python',
  'java',
  'kotlin',
  'go',
  'rust',
  'csharp',
  'cpp',
  'php',
  'ruby',
  'scala',
  'elixir',
  'swift',
  'dart',
  'sql',
  'bash',
  'nodejs',
  'nestjs',
  'express',
  'fastify',
  'django',
  'fastapi',
  'flask',
  'spring',
  'dotnet',
  'laravel',
  'rails',
  'graphql',
  'grpc',
  'react',
  'nextjs',
  'vue',
  'nuxt',
  'angular',
  'svelte',
  'tailwindcss',
  'react_native',
  'flutter',
  'postgresql',
  'mysql',
  'mongodb',
  'redis',
  'elasticsearch',
  'kafka',
  'rabbitmq',
  'spark',
  'airflow',
  'dbt',
  'snowflake',
  'aws',
  'gcp',
  'azure',
  'docker',
  'kubernetes',
  'terraform',
  'ansible',
  'github_actions',
  'gitlab_ci',
  'linux',
  'nginx',
  'prometheus',
  'grafana',
  'pytorch',
  'tensorflow',
  'langchain',
] as const;
export type Technology = (typeof TECHNOLOGIES)[number];
