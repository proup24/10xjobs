export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      arrangements: {
        Row: {
          aliases: string[];
          approvedAt: string | null;
          code: string;
          firstSeenAt: string;
          label: string;
          occurrences: number;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          aliases: string[];
          approvedAt?: string | null;
          code: string;
          firstSeenAt: string;
          label: string;
          occurrences?: number;
          status: string;
        };
        Update: {
          aliases?: string[];
          approvedAt?: string | null;
          code?: string;
          firstSeenAt?: string;
          label?: string;
          occurrences?: number;
          status?: string;
        };
        Relationships: [];
      };
      auto_silence_dismissals: {
        Row: {
          authorKey: string;
          dismissedAt: string;
          dismissedBy: string | null;
        };
        ComputedFields: never;
        Insert: {
          authorKey: string;
          dismissedAt?: string;
          dismissedBy?: string | null;
        };
        Update: {
          authorKey?: string;
          dismissedAt?: string;
          dismissedBy?: string | null;
        };
        Relationships: [];
      };
      blocked_authors: {
        Row: {
          authorKey: string;
          createdAt: string;
          id: string;
          name: string | null;
          profileUrl: string | null;
          updatedAt: string;
          userId: string;
        };
        ComputedFields: never;
        Insert: {
          authorKey: string;
          createdAt?: string;
          id: string;
          name?: string | null;
          profileUrl?: string | null;
          updatedAt?: string;
          userId: string;
        };
        Update: {
          authorKey?: string;
          createdAt?: string;
          id?: string;
          name?: string | null;
          profileUrl?: string | null;
          updatedAt?: string;
          userId?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'blocked_authors_userId_fkey';
            columns: ['userId'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      cities: {
        Row: {
          aliases: string[];
          approvedAt: string | null;
          countryCode: string;
          firstSeenAt: string;
          geonamesId: number | null;
          id: string;
          name: string;
          nameKey: string;
          occurrences: number;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          aliases: string[];
          approvedAt?: string | null;
          countryCode: string;
          firstSeenAt: string;
          geonamesId?: number | null;
          id: string;
          name: string;
          nameKey: string;
          occurrences?: number;
          status: string;
        };
        Update: {
          aliases?: string[];
          approvedAt?: string | null;
          countryCode?: string;
          firstSeenAt?: string;
          geonamesId?: number | null;
          id?: string;
          name?: string;
          nameKey?: string;
          occurrences?: number;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'cities_countryCode_fkey';
            columns: ['countryCode'];
            isOneToOne: false;
            referencedRelation: 'countries';
            referencedColumns: ['code'];
          },
        ];
      };
      collection_batches: {
        Row: {
          actor: string;
          apifyRunId: string | null;
          attempts: number;
          channel: string;
          createdAt: string;
          formatVersion: number;
          id: string;
          ingestedAt: string | null;
          itemCount: number;
          lastError: string | null;
          observedAt: string;
          report: Json | null;
          segmentRunId: string;
          status: string;
          storageKey: string;
        };
        ComputedFields: never;
        Insert: {
          actor: string;
          apifyRunId?: string | null;
          attempts?: number;
          channel: string;
          createdAt?: string;
          formatVersion: number;
          id: string;
          ingestedAt?: string | null;
          itemCount: number;
          lastError?: string | null;
          observedAt: string;
          report?: Json | null;
          segmentRunId: string;
          status: string;
          storageKey: string;
        };
        Update: {
          actor?: string;
          apifyRunId?: string | null;
          attempts?: number;
          channel?: string;
          createdAt?: string;
          formatVersion?: number;
          id?: string;
          ingestedAt?: string | null;
          itemCount?: number;
          lastError?: string | null;
          observedAt?: string;
          report?: Json | null;
          segmentRunId?: string;
          status?: string;
          storageKey?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'collection_batches_segmentRunId_fkey';
            columns: ['segmentRunId'];
            isOneToOne: true;
            referencedRelation: 'search_segment_runs';
            referencedColumns: ['id'];
          },
        ];
      };
      companies: {
        Row: {
          createdAt: string;
          description: string | null;
          employeeCount: number | null;
          employeeCountMax: number | null;
          employeeCountMin: number | null;
          firstSeenAt: string;
          headquartersCountryCode: string | null;
          id: string;
          industries: string[];
          lastSeenAt: string;
          linkedinId: string;
          linkedinUrl: string | null;
          name: string | null;
          specialities: string[];
          universalName: string | null;
          updatedAt: string;
          website: string | null;
        };
        ComputedFields: never;
        Insert: {
          createdAt?: string;
          description?: string | null;
          employeeCount?: number | null;
          employeeCountMax?: number | null;
          employeeCountMin?: number | null;
          firstSeenAt: string;
          headquartersCountryCode?: string | null;
          id: string;
          industries: string[];
          lastSeenAt: string;
          linkedinId: string;
          linkedinUrl?: string | null;
          name?: string | null;
          specialities: string[];
          universalName?: string | null;
          updatedAt?: string;
          website?: string | null;
        };
        Update: {
          createdAt?: string;
          description?: string | null;
          employeeCount?: number | null;
          employeeCountMax?: number | null;
          employeeCountMin?: number | null;
          firstSeenAt?: string;
          headquartersCountryCode?: string | null;
          id?: string;
          industries?: string[];
          lastSeenAt?: string;
          linkedinId?: string;
          linkedinUrl?: string | null;
          name?: string | null;
          specialities?: string[];
          universalName?: string | null;
          updatedAt?: string;
          website?: string | null;
        };
        Relationships: [];
      };
      contacts: {
        Row: {
          createdAt: string;
          id: string;
          isPrimary: boolean;
          kind: string;
          label: string | null;
          updatedAt: string;
          userId: string;
          value: string;
        };
        ComputedFields: never;
        Insert: {
          createdAt?: string;
          id: string;
          isPrimary?: boolean;
          kind: string;
          label?: string | null;
          updatedAt?: string;
          userId: string;
          value: string;
        };
        Update: {
          createdAt?: string;
          id?: string;
          isPrimary?: boolean;
          kind?: string;
          label?: string | null;
          updatedAt?: string;
          userId?: string;
          value?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'contacts_userId_fkey';
            columns: ['userId'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      contract_types: {
        Row: {
          aliases: string[];
          approvedAt: string | null;
          code: string;
          firstSeenAt: string;
          label: string;
          occurrences: number;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          aliases: string[];
          approvedAt?: string | null;
          code: string;
          firstSeenAt: string;
          label: string;
          occurrences?: number;
          status: string;
        };
        Update: {
          aliases?: string[];
          approvedAt?: string | null;
          code?: string;
          firstSeenAt?: string;
          label?: string;
          occurrences?: number;
          status?: string;
        };
        Relationships: [];
      };
      countries: {
        Row: {
          aliases: string[];
          approvedAt: string | null;
          code: string;
          firstSeenAt: string;
          label: string;
          occurrences: number;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          aliases: string[];
          approvedAt?: string | null;
          code: string;
          firstSeenAt: string;
          label: string;
          occurrences?: number;
          status: string;
        };
        Update: {
          aliases?: string[];
          approvedAt?: string | null;
          code?: string;
          firstSeenAt?: string;
          label?: string;
          occurrences?: number;
          status?: string;
        };
        Relationships: [];
      };
      engagements: {
        Row: {
          aliases: string[];
          approvedAt: string | null;
          code: string;
          firstSeenAt: string;
          label: string;
          occurrences: number;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          aliases: string[];
          approvedAt?: string | null;
          code: string;
          firstSeenAt: string;
          label: string;
          occurrences?: number;
          status: string;
        };
        Update: {
          aliases?: string[];
          approvedAt?: string | null;
          code?: string;
          firstSeenAt?: string;
          label?: string;
          occurrences?: number;
          status?: string;
        };
        Relationships: [];
      };
      exchange_rates: {
        Row: {
          currency: string;
          fetchedAt: string;
          perUsd: number;
        };
        ComputedFields: never;
        Insert: {
          currency: string;
          fetchedAt: string;
          perUsd: number;
        };
        Update: {
          currency?: string;
          fetchedAt?: string;
          perUsd?: number;
        };
        Relationships: [];
      };
      fact_reports: {
        Row: {
          createdAt: string;
          extractionId: string | null;
          field: string;
          id: string;
          jobId: string;
          listingValue: Json | null;
          note: string | null;
          processorValue: Json | null;
          proposedValue: string;
          quote: string | null;
          userId: string;
        };
        ComputedFields: never;
        Insert: {
          createdAt?: string;
          extractionId?: string | null;
          field: string;
          id?: string;
          jobId: string;
          listingValue?: Json | null;
          note?: string | null;
          processorValue?: Json | null;
          proposedValue: string;
          quote?: string | null;
          userId: string;
        };
        Update: {
          createdAt?: string;
          extractionId?: string | null;
          field?: string;
          id?: string;
          jobId?: string;
          listingValue?: Json | null;
          note?: string | null;
          processorValue?: Json | null;
          proposedValue?: string;
          quote?: string | null;
          userId?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'fact_reports_extractionId_fkey';
            columns: ['extractionId'];
            isOneToOne: false;
            referencedRelation: 'job_extractions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'fact_reports_jobId_fkey';
            columns: ['jobId'];
            isOneToOne: false;
            referencedRelation: 'normalized_jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'fact_reports_userId_fkey';
            columns: ['userId'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      indeed_markets: {
        Row: {
          countryCode: string;
          mainRemote: boolean;
          remoteLocation: string;
          site: string;
        };
        ComputedFields: never;
        Insert: {
          countryCode: string;
          mainRemote?: boolean;
          remoteLocation?: string;
          site: string;
        };
        Update: {
          countryCode?: string;
          mainRemote?: boolean;
          remoteLocation?: string;
          site?: string;
        };
        Relationships: [];
      };
      iso_currencies: {
        Row: {
          code: string;
          label: string;
        };
        ComputedFields: never;
        Insert: {
          code: string;
          label: string;
        };
        Update: {
          code?: string;
          label?: string;
        };
        Relationships: [];
      };
      iso_languages: {
        Row: {
          code: string;
          label: string;
        };
        ComputedFields: never;
        Insert: {
          code: string;
          label: string;
        };
        Update: {
          code?: string;
          label?: string;
        };
        Relationships: [];
      };
      job_decisions: {
        Row: {
          createdAt: string;
          decidedAt: string;
          id: string;
          jobId: string;
          matchSnapshot: Json | null;
          note: string | null;
          reason: string | null;
          status: string;
          updatedAt: string;
          userId: string;
        };
        ComputedFields: never;
        Insert: {
          createdAt?: string;
          decidedAt?: string;
          id?: string;
          jobId: string;
          matchSnapshot?: Json | null;
          note?: string | null;
          reason?: string | null;
          status: string;
          updatedAt?: string;
          userId: string;
        };
        Update: {
          createdAt?: string;
          decidedAt?: string;
          id?: string;
          jobId?: string;
          matchSnapshot?: Json | null;
          note?: string | null;
          reason?: string | null;
          status?: string;
          updatedAt?: string;
          userId?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'job_decisions_jobId_fkey';
            columns: ['jobId'];
            isOneToOne: false;
            referencedRelation: 'normalized_jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'job_decisions_userId_fkey';
            columns: ['userId'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      job_extractions: {
        Row: {
          arrangement: string | null;
          cityIds: string[];
          contractType: string | null;
          costUsd: number;
          countryCodes: string[];
          createdAt: string;
          data: NonNullable<Json>;
          decisionModel: string | null;
          docType: string;
          engagement: string | null;
          extractionModel: string;
          id: string;
          inputHash: string;
          isSoftwareEngineeringRole: boolean | null;
          jobId: string;
          mainStackTags: string[];
          needsReview: boolean;
          niceTags: string[];
          promptHash: string;
          regionCodes: string[];
          requiredTags: string[];
          roleKind: string | null;
          salaryCurrency: string | null;
          salaryMax: number | null;
          salaryMin: number | null;
          salaryPeriod: string | null;
          schemaVersion: number;
          seniority: string | null;
          techTags: string[];
          verdict: string | null;
          verdictConfidence: string | null;
          verdictReason: string | null;
          worldwide: boolean;
        };
        ComputedFields: never;
        Insert: {
          arrangement?: string | null;
          cityIds: string[];
          contractType?: string | null;
          costUsd: number;
          countryCodes: string[];
          createdAt?: string;
          data: NonNullable<Json>;
          decisionModel?: string | null;
          docType?: string;
          engagement?: string | null;
          extractionModel: string;
          id: string;
          inputHash: string;
          isSoftwareEngineeringRole?: boolean | null;
          jobId: string;
          mainStackTags: string[];
          needsReview: boolean;
          niceTags?: string[];
          promptHash: string;
          regionCodes: string[];
          requiredTags?: string[];
          roleKind?: string | null;
          salaryCurrency?: string | null;
          salaryMax?: number | null;
          salaryMin?: number | null;
          salaryPeriod?: string | null;
          schemaVersion: number;
          seniority?: string | null;
          techTags: string[];
          verdict?: string | null;
          verdictConfidence?: string | null;
          verdictReason?: string | null;
          worldwide: boolean;
        };
        Update: {
          arrangement?: string | null;
          cityIds?: string[];
          contractType?: string | null;
          costUsd?: number;
          countryCodes?: string[];
          createdAt?: string;
          data?: NonNullable<Json>;
          decisionModel?: string | null;
          docType?: string;
          engagement?: string | null;
          extractionModel?: string;
          id?: string;
          inputHash?: string;
          isSoftwareEngineeringRole?: boolean | null;
          jobId?: string;
          mainStackTags?: string[];
          needsReview?: boolean;
          niceTags?: string[];
          promptHash?: string;
          regionCodes?: string[];
          requiredTags?: string[];
          roleKind?: string | null;
          salaryCurrency?: string | null;
          salaryMax?: number | null;
          salaryMin?: number | null;
          salaryPeriod?: string | null;
          schemaVersion?: number;
          seniority?: string | null;
          techTags?: string[];
          verdict?: string | null;
          verdictConfidence?: string | null;
          verdictReason?: string | null;
          worldwide?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'job_extractions_arrangement_fkey';
            columns: ['arrangement'];
            isOneToOne: false;
            referencedRelation: 'arrangements';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'job_extractions_contractType_fkey';
            columns: ['contractType'];
            isOneToOne: false;
            referencedRelation: 'contract_types';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'job_extractions_engagement_fkey';
            columns: ['engagement'];
            isOneToOne: false;
            referencedRelation: 'engagements';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'job_extractions_jobId_fkey';
            columns: ['jobId'];
            isOneToOne: false;
            referencedRelation: 'normalized_jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'job_extractions_roleKind_fkey';
            columns: ['roleKind'];
            isOneToOne: false;
            referencedRelation: 'role_kinds';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'job_extractions_seniority_fkey';
            columns: ['seniority'];
            isOneToOne: false;
            referencedRelation: 'seniorities';
            referencedColumns: ['code'];
          },
        ];
      };
      job_fact_conflicts: {
        Row: {
          createdAt: string;
          descriptionValue: NonNullable<Json>;
          extractionId: string;
          field: string;
          id: string;
          jobId: string;
          listingValue: NonNullable<Json>;
          quote: string;
          winner: string;
        };
        ComputedFields: never;
        Insert: {
          createdAt?: string;
          descriptionValue: NonNullable<Json>;
          extractionId: string;
          field: string;
          id: string;
          jobId: string;
          listingValue: NonNullable<Json>;
          quote: string;
          winner: string;
        };
        Update: {
          createdAt?: string;
          descriptionValue?: NonNullable<Json>;
          extractionId?: string;
          field?: string;
          id?: string;
          jobId?: string;
          listingValue?: NonNullable<Json>;
          quote?: string;
          winner?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'job_fact_conflicts_extractionId_fkey';
            columns: ['extractionId'];
            isOneToOne: false;
            referencedRelation: 'job_extractions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'job_fact_conflicts_jobId_fkey';
            columns: ['jobId'];
            isOneToOne: false;
            referencedRelation: 'normalized_jobs';
            referencedColumns: ['id'];
          },
        ];
      };
      job_facts: {
        Row: {
          builtAt: string;
          closed: boolean;
          createdAt: string;
          extractionId: string;
          facts: NonNullable<Json>;
          factsHash: string;
          factsVersion: number;
          jobId: string;
          updatedAt: string;
        };
        ComputedFields: never;
        Insert: {
          builtAt: string;
          closed: boolean;
          createdAt?: string;
          extractionId: string;
          facts: NonNullable<Json>;
          factsHash: string;
          factsVersion: number;
          jobId: string;
          updatedAt?: string;
        };
        Update: {
          builtAt?: string;
          closed?: boolean;
          createdAt?: string;
          extractionId?: string;
          facts?: NonNullable<Json>;
          factsHash?: string;
          factsVersion?: number;
          jobId?: string;
          updatedAt?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'job_facts_extractionId_fkey';
            columns: ['extractionId'];
            isOneToOne: false;
            referencedRelation: 'job_extractions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'job_facts_jobId_fkey';
            columns: ['jobId'];
            isOneToOne: true;
            referencedRelation: 'normalized_jobs';
            referencedColumns: ['id'];
          },
        ];
      };
      job_matches: {
        Row: {
          checks: NonNullable<Json>;
          createdAt: string;
          decidedAt: string;
          eligibilityVersion: number | null;
          extractionId: string;
          factsHash: string | null;
          id: string;
          jobId: string;
          matcherVersion: number;
          outcome: string;
          profileId: string;
          profileVersion: number | null;
          reviewField: string | null;
          reviewRule: string | null;
          stackScore: number | null;
          unverified: boolean;
          updatedAt: string;
          userId: string;
        };
        ComputedFields: never;
        Insert: {
          checks: NonNullable<Json>;
          createdAt?: string;
          decidedAt: string;
          eligibilityVersion?: number | null;
          extractionId: string;
          factsHash?: string | null;
          id: string;
          jobId: string;
          matcherVersion: number;
          outcome: string;
          profileId: string;
          profileVersion?: number | null;
          reviewField?: string | null;
          reviewRule?: string | null;
          stackScore?: number | null;
          unverified: boolean;
          updatedAt?: string;
          userId: string;
        };
        Update: {
          checks?: NonNullable<Json>;
          createdAt?: string;
          decidedAt?: string;
          eligibilityVersion?: number | null;
          extractionId?: string;
          factsHash?: string | null;
          id?: string;
          jobId?: string;
          matcherVersion?: number;
          outcome?: string;
          profileId?: string;
          profileVersion?: number | null;
          reviewField?: string | null;
          reviewRule?: string | null;
          stackScore?: number | null;
          unverified?: boolean;
          updatedAt?: string;
          userId?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'job_matches_extractionId_fkey';
            columns: ['extractionId'];
            isOneToOne: false;
            referencedRelation: 'job_extractions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'job_matches_jobId_fkey';
            columns: ['jobId'];
            isOneToOne: false;
            referencedRelation: 'normalized_jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'job_matches_profileId_userId_fkey';
            columns: ['profileId', 'userId'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id', 'userId'];
          },
          {
            foreignKeyName: 'job_matches_userId_fkey';
            columns: ['userId'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      job_views: {
        Row: {
          id: string;
          jobId: string;
          userId: string;
          viewedAt: string;
        };
        ComputedFields: never;
        Insert: {
          id?: string;
          jobId: string;
          userId: string;
          viewedAt?: string;
        };
        Update: {
          id?: string;
          jobId?: string;
          userId?: string;
          viewedAt?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'job_views_jobId_fkey';
            columns: ['jobId'];
            isOneToOne: false;
            referencedRelation: 'normalized_jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'job_views_userId_fkey';
            columns: ['userId'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      junk_flags: {
        Row: {
          aliases: string[];
          approvedAt: string | null;
          code: string;
          firstSeenAt: string;
          label: string;
          occurrences: number;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          aliases: string[];
          approvedAt?: string | null;
          code: string;
          firstSeenAt: string;
          label: string;
          occurrences?: number;
          status: string;
        };
        Update: {
          aliases?: string[];
          approvedAt?: string | null;
          code?: string;
          firstSeenAt?: string;
          label?: string;
          occurrences?: number;
          status?: string;
        };
        Relationships: [];
      };
      linkedin_search_splits: {
        Row: {
          createdAt: string;
          groupKey: string;
          parts: number;
          splitAt: string;
          updatedAt: string;
        };
        ComputedFields: never;
        Insert: {
          createdAt?: string;
          groupKey: string;
          parts: number;
          splitAt: string;
          updatedAt?: string;
        };
        Update: {
          createdAt?: string;
          groupKey?: string;
          parts?: number;
          splitAt?: string;
          updatedAt?: string;
        };
        Relationships: [];
      };
      match_reviews: {
        Row: {
          choice: string;
          createdAt: string;
          field: string;
          id: string;
          jobId: string;
          matchId: string;
          note: string | null;
          profileId: string;
          profileVersion: number | null;
          rule: string;
          updatedAt: string;
          userId: string;
        };
        ComputedFields: never;
        Insert: {
          choice: string;
          createdAt?: string;
          field: string;
          id?: string;
          jobId: string;
          matchId: string;
          note?: string | null;
          profileId: string;
          profileVersion?: number | null;
          rule: string;
          updatedAt?: string;
          userId: string;
        };
        Update: {
          choice?: string;
          createdAt?: string;
          field?: string;
          id?: string;
          jobId?: string;
          matchId?: string;
          note?: string | null;
          profileId?: string;
          profileVersion?: number | null;
          rule?: string;
          updatedAt?: string;
          userId?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'match_reviews_matchId_fkey';
            columns: ['matchId'];
            isOneToOne: false;
            referencedRelation: 'job_matches';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'match_reviews_userId_fkey';
            columns: ['userId'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      normalized_job_sources: {
        Row: {
          id: string;
          jobId: string;
          linkedAt: string;
          normalizedVersionId: string;
          rawItemId: string;
        };
        ComputedFields: never;
        Insert: {
          id: string;
          jobId: string;
          linkedAt: string;
          normalizedVersionId: string;
          rawItemId: string;
        };
        Update: {
          id?: string;
          jobId?: string;
          linkedAt?: string;
          normalizedVersionId?: string;
          rawItemId?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'normalized_job_sources_jobId_fkey';
            columns: ['jobId'];
            isOneToOne: false;
            referencedRelation: 'normalized_jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'normalized_job_sources_normalizedVersionId_fkey';
            columns: ['normalizedVersionId'];
            isOneToOne: false;
            referencedRelation: 'normalized_versions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'normalized_job_sources_rawItemId_fkey';
            columns: ['rawItemId'];
            isOneToOne: true;
            referencedRelation: 'raw_items';
            referencedColumns: ['id'];
          },
        ];
      };
      normalized_jobs: {
        Row: {
          applicantCount: number | null;
          applicantTrackingSystem: string | null;
          applyUrl: string | null;
          city: string | null;
          closed: boolean;
          companyId: string | null;
          companyName: string | null;
          companyUrl: string | null;
          contractType: string | null;
          countryCode: string | null;
          createdAt: string;
          currentExtractionId: string | null;
          descriptionHtml: string | null;
          descriptionText: string | null;
          employmentType: string | null;
          experienceLevel: string | null;
          expiresAt: string | null;
          fieldSources: NonNullable<Json>;
          firstSeenAt: string;
          geoId: string | null;
          id: string;
          jobKey: string;
          kind: string;
          lastSeenAt: string;
          listingState: string | null;
          location: string | null;
          mergedIntoId: string | null;
          normalizerVersion: number;
          parentJobId: string | null;
          postedAt: string | null;
          posterName: string | null;
          posterProfileUrl: string | null;
          posterType: string | null;
          postingUrl: string;
          postSources: Json | null;
          processedAt: string | null;
          processingAttempts: number;
          processingError: string | null;
          processingReason: string | null;
          processingRequestedAt: string | null;
          processingStartedAt: string | null;
          processingStatus: string | null;
          publishedAt: string | null;
          regionCode: string | null;
          remoteAllowed: boolean | null;
          roleKey: string | null;
          salaryCurrency: string | null;
          salaryMax: number | null;
          salaryMin: number | null;
          salaryPeriod: string | null;
          salaryProvidedByEmployer: boolean | null;
          salaryText: string | null;
          sector: string | null;
          state: string | null;
          status: string;
          title: string | null;
          updatedAt: string;
          workplaceType: string | null;
        };
        ComputedFields: never;
        Insert: {
          applicantCount?: number | null;
          applicantTrackingSystem?: string | null;
          applyUrl?: string | null;
          city?: string | null;
          closed: boolean;
          companyId?: string | null;
          companyName?: string | null;
          companyUrl?: string | null;
          contractType?: string | null;
          countryCode?: string | null;
          createdAt?: string;
          currentExtractionId?: string | null;
          descriptionHtml?: string | null;
          descriptionText?: string | null;
          employmentType?: string | null;
          experienceLevel?: string | null;
          expiresAt?: string | null;
          fieldSources: NonNullable<Json>;
          firstSeenAt: string;
          geoId?: string | null;
          id: string;
          jobKey: string;
          kind: string;
          lastSeenAt: string;
          listingState?: string | null;
          location?: string | null;
          mergedIntoId?: string | null;
          normalizerVersion: number;
          parentJobId?: string | null;
          postedAt?: string | null;
          posterName?: string | null;
          posterProfileUrl?: string | null;
          posterType?: string | null;
          postingUrl: string;
          postSources?: Json | null;
          processedAt?: string | null;
          processingAttempts?: number;
          processingError?: string | null;
          processingReason?: string | null;
          processingRequestedAt?: string | null;
          processingStartedAt?: string | null;
          processingStatus?: string | null;
          publishedAt?: string | null;
          regionCode?: string | null;
          remoteAllowed?: boolean | null;
          roleKey?: string | null;
          salaryCurrency?: string | null;
          salaryMax?: number | null;
          salaryMin?: number | null;
          salaryPeriod?: string | null;
          salaryProvidedByEmployer?: boolean | null;
          salaryText?: string | null;
          sector?: string | null;
          state?: string | null;
          status: string;
          title?: string | null;
          updatedAt?: string;
          workplaceType?: string | null;
        };
        Update: {
          applicantCount?: number | null;
          applicantTrackingSystem?: string | null;
          applyUrl?: string | null;
          city?: string | null;
          closed?: boolean;
          companyId?: string | null;
          companyName?: string | null;
          companyUrl?: string | null;
          contractType?: string | null;
          countryCode?: string | null;
          createdAt?: string;
          currentExtractionId?: string | null;
          descriptionHtml?: string | null;
          descriptionText?: string | null;
          employmentType?: string | null;
          experienceLevel?: string | null;
          expiresAt?: string | null;
          fieldSources?: NonNullable<Json>;
          firstSeenAt?: string;
          geoId?: string | null;
          id?: string;
          jobKey?: string;
          kind?: string;
          lastSeenAt?: string;
          listingState?: string | null;
          location?: string | null;
          mergedIntoId?: string | null;
          normalizerVersion?: number;
          parentJobId?: string | null;
          postedAt?: string | null;
          posterName?: string | null;
          posterProfileUrl?: string | null;
          posterType?: string | null;
          postingUrl?: string;
          postSources?: Json | null;
          processedAt?: string | null;
          processingAttempts?: number;
          processingError?: string | null;
          processingReason?: string | null;
          processingRequestedAt?: string | null;
          processingStartedAt?: string | null;
          processingStatus?: string | null;
          publishedAt?: string | null;
          regionCode?: string | null;
          remoteAllowed?: boolean | null;
          roleKey?: string | null;
          salaryCurrency?: string | null;
          salaryMax?: number | null;
          salaryMin?: number | null;
          salaryPeriod?: string | null;
          salaryProvidedByEmployer?: boolean | null;
          salaryText?: string | null;
          sector?: string | null;
          state?: string | null;
          status?: string;
          title?: string | null;
          updatedAt?: string;
          workplaceType?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'normalized_jobs_companyId_fkey';
            columns: ['companyId'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'normalized_jobs_currentExtractionId_fkey';
            columns: ['currentExtractionId'];
            isOneToOne: false;
            referencedRelation: 'job_extractions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'normalized_jobs_mergedIntoId_fkey';
            columns: ['mergedIntoId'];
            isOneToOne: false;
            referencedRelation: 'normalized_jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'normalized_jobs_parentJobId_fkey';
            columns: ['parentJobId'];
            isOneToOne: false;
            referencedRelation: 'normalized_jobs';
            referencedColumns: ['id'];
          },
        ];
      };
      normalized_versions: {
        Row: {
          createdAt: string;
          id: string;
          jobKey: string | null;
          normalizerVersion: number;
          rawVersionId: string;
          reason: string | null;
          record: Json | null;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          createdAt?: string;
          id: string;
          jobKey?: string | null;
          normalizerVersion: number;
          rawVersionId: string;
          reason?: string | null;
          record?: Json | null;
          status: string;
        };
        Update: {
          createdAt?: string;
          id?: string;
          jobKey?: string | null;
          normalizerVersion?: number;
          rawVersionId?: string;
          reason?: string | null;
          record?: Json | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'normalized_versions_rawVersionId_fkey';
            columns: ['rawVersionId'];
            isOneToOne: false;
            referencedRelation: 'raw_item_versions';
            referencedColumns: ['id'];
          },
        ];
      };
      processing_attempts: {
        Row: {
          cachedInputTokens: number;
          costUsd: number;
          createdAt: string;
          docType: string;
          error: string | null;
          eval: boolean;
          extractionId: string | null;
          id: string;
          inputTokens: number;
          jobId: string | null;
          latencyMs: number;
          model: string;
          outcome: string;
          outputTokens: number;
          providerRequestId: string | null;
          quoteFailures: number;
          step: string;
        };
        ComputedFields: never;
        Insert: {
          cachedInputTokens: number;
          costUsd: number;
          createdAt?: string;
          docType?: string;
          error?: string | null;
          eval?: boolean;
          extractionId?: string | null;
          id: string;
          inputTokens: number;
          jobId?: string | null;
          latencyMs: number;
          model: string;
          outcome: string;
          outputTokens: number;
          providerRequestId?: string | null;
          quoteFailures?: number;
          step: string;
        };
        Update: {
          cachedInputTokens?: number;
          costUsd?: number;
          createdAt?: string;
          docType?: string;
          error?: string | null;
          eval?: boolean;
          extractionId?: string | null;
          id?: string;
          inputTokens?: number;
          jobId?: string | null;
          latencyMs?: number;
          model?: string;
          outcome?: string;
          outputTokens?: number;
          providerRequestId?: string | null;
          quoteFailures?: number;
          step?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'processing_attempts_extractionId_fkey';
            columns: ['extractionId'];
            isOneToOne: false;
            referencedRelation: 'job_extractions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'processing_attempts_jobId_fkey';
            columns: ['jobId'];
            isOneToOne: false;
            referencedRelation: 'normalized_jobs';
            referencedColumns: ['id'];
          },
        ];
      };
      profile_query_search_builders: {
        Row: {
          createdAt: string;
          id: string;
          profileId: string;
          queryId: string;
        };
        ComputedFields: never;
        Insert: {
          createdAt?: string;
          id: string;
          profileId: string;
          queryId: string;
        };
        Update: {
          createdAt?: string;
          id?: string;
          profileId?: string;
          queryId?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'profile_query_search_builders_profileId_fkey';
            columns: ['profileId'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'profile_query_search_builders_queryId_fkey';
            columns: ['queryId'];
            isOneToOne: false;
            referencedRelation: 'query_search_builder';
            referencedColumns: ['id'];
          },
        ];
      };
      profile_setup_drafts: {
        Row: {
          answers: NonNullable<Json>;
          createdAt: string;
          id: string;
          updatedAt: string;
          userId: string;
        };
        ComputedFields: never;
        Insert: {
          answers: NonNullable<Json>;
          createdAt?: string;
          id: string;
          updatedAt?: string;
          userId: string;
        };
        Update: {
          answers?: NonNullable<Json>;
          createdAt?: string;
          id?: string;
          updatedAt?: string;
          userId?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'profile_setup_drafts_userId_fkey';
            columns: ['userId'];
            isOneToOne: true;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      profile_skills: {
        Row: {
          createdAt: string;
          domain: string;
          id: string;
          importance: number;
          mastery: number;
          profileId: string;
          technology: string;
          updatedAt: string;
          userId: string;
        };
        ComputedFields: never;
        Insert: {
          createdAt?: string;
          domain: string;
          id: string;
          importance?: number;
          mastery: number;
          profileId: string;
          technology: string;
          updatedAt?: string;
          userId: string;
        };
        Update: {
          createdAt?: string;
          domain?: string;
          id?: string;
          importance?: number;
          mastery?: number;
          profileId?: string;
          technology?: string;
          updatedAt?: string;
          userId?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'profile_skills_profileId_userId_fkey';
            columns: ['profileId', 'userId'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id', 'userId'];
          },
          {
            foreignKeyName: 'profile_skills_userId_fkey';
            columns: ['userId'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          acceptedCurrencies: string[];
          acceptsAnyCurrency: boolean;
          contractTypes: string[];
          createdAt: string;
          engagements: string[];
          id: string;
          indeedSearch: boolean;
          languages: NonNullable<Json>;
          locations: NonNullable<Json>;
          matchVersion: number;
          noticePeriodDays: number;
          position: string;
          postSearch: boolean;
          publishedAt: string | null;
          resumeFilename: string | null;
          resumeKey: string | null;
          resumeSha256: string | null;
          resumeSizeBytes: number | null;
          resumeUploadedAt: string | null;
          salaryCurrency: string | null;
          salaryMin: number | null;
          salaryPeriod: string | null;
          searchesVersion: number | null;
          seniorities: string[];
          state: string;
          timezoneCurrent: number;
          timezoneMax: number;
          timezoneMin: number;
          updatedAt: string;
          userId: string;
          yearsOfExperience: number;
        };
        ComputedFields: never;
        Insert: {
          acceptedCurrencies?: string[];
          acceptsAnyCurrency?: boolean;
          contractTypes: string[];
          createdAt?: string;
          engagements: string[];
          id: string;
          indeedSearch?: boolean;
          languages: NonNullable<Json>;
          locations: NonNullable<Json>;
          matchVersion?: number;
          noticePeriodDays: number;
          position: string;
          postSearch?: boolean;
          publishedAt?: string | null;
          resumeFilename?: string | null;
          resumeKey?: string | null;
          resumeSha256?: string | null;
          resumeSizeBytes?: number | null;
          resumeUploadedAt?: string | null;
          salaryCurrency?: string | null;
          salaryMin?: number | null;
          salaryPeriod?: string | null;
          searchesVersion?: number | null;
          seniorities: string[];
          state?: string;
          timezoneCurrent: number;
          timezoneMax: number;
          timezoneMin: number;
          updatedAt?: string;
          userId: string;
          yearsOfExperience: number;
        };
        Update: {
          acceptedCurrencies?: string[];
          acceptsAnyCurrency?: boolean;
          contractTypes?: string[];
          createdAt?: string;
          engagements?: string[];
          id?: string;
          indeedSearch?: boolean;
          languages?: NonNullable<Json>;
          locations?: NonNullable<Json>;
          matchVersion?: number;
          noticePeriodDays?: number;
          position?: string;
          postSearch?: boolean;
          publishedAt?: string | null;
          resumeFilename?: string | null;
          resumeKey?: string | null;
          resumeSha256?: string | null;
          resumeSizeBytes?: number | null;
          resumeUploadedAt?: string | null;
          salaryCurrency?: string | null;
          salaryMin?: number | null;
          salaryPeriod?: string | null;
          searchesVersion?: number | null;
          seniorities?: string[];
          state?: string;
          timezoneCurrent?: number;
          timezoneMax?: number;
          timezoneMin?: number;
          updatedAt?: string;
          userId?: string;
          yearsOfExperience?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'profiles_userId_fkey';
            columns: ['userId'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      query_search_builder: {
        Row: {
          associatedProfiles: number;
          channel: string;
          claimExpiresAt: string | null;
          claimRunId: string | null;
          claimWindowEnd: string | null;
          claimWindowStart: string | null;
          coveredUntil: string | null;
          createdAt: string;
          domain: string;
          experience: string;
          hash: string;
          id: string;
          isActive: boolean;
          isDeleted: boolean;
          keyword: string;
          location: string;
          params: NonNullable<Json>;
          pausedAt: string | null;
          technologies: string[];
          type: string;
          updatedAt: string;
          version: number;
        };
        ComputedFields: never;
        Insert: {
          associatedProfiles?: number;
          channel: string;
          claimExpiresAt?: string | null;
          claimRunId?: string | null;
          claimWindowEnd?: string | null;
          claimWindowStart?: string | null;
          coveredUntil?: string | null;
          createdAt?: string;
          domain: string;
          experience: string;
          hash: string;
          id: string;
          isActive?: boolean;
          isDeleted?: boolean;
          keyword: string;
          location: string;
          params: NonNullable<Json>;
          pausedAt?: string | null;
          technologies: string[];
          type: string;
          updatedAt?: string;
          version: number;
        };
        Update: {
          associatedProfiles?: number;
          channel?: string;
          claimExpiresAt?: string | null;
          claimRunId?: string | null;
          claimWindowEnd?: string | null;
          claimWindowStart?: string | null;
          coveredUntil?: string | null;
          createdAt?: string;
          domain?: string;
          experience?: string;
          hash?: string;
          id?: string;
          isActive?: boolean;
          isDeleted?: boolean;
          keyword?: string;
          location?: string;
          params?: NonNullable<Json>;
          pausedAt?: string | null;
          technologies?: string[];
          type?: string;
          updatedAt?: string;
          version?: number;
        };
        Relationships: [];
      };
      raw_item_sightings: {
        Row: {
          attribution: string;
          batchId: string;
          id: string;
          observedAt: string;
          queryId: string | null;
          rank: number | null;
          rawItemId: string;
          versionId: string;
        };
        ComputedFields: never;
        Insert: {
          attribution: string;
          batchId: string;
          id: string;
          observedAt: string;
          queryId?: string | null;
          rank?: number | null;
          rawItemId: string;
          versionId: string;
        };
        Update: {
          attribution?: string;
          batchId?: string;
          id?: string;
          observedAt?: string;
          queryId?: string | null;
          rank?: number | null;
          rawItemId?: string;
          versionId?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'raw_item_sightings_batchId_fkey';
            columns: ['batchId'];
            isOneToOne: false;
            referencedRelation: 'collection_batches';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'raw_item_sightings_queryId_fkey';
            columns: ['queryId'];
            isOneToOne: false;
            referencedRelation: 'query_search_builder';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'raw_item_sightings_rawItemId_fkey';
            columns: ['rawItemId'];
            isOneToOne: false;
            referencedRelation: 'raw_items';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'raw_item_sightings_versionId_fkey';
            columns: ['versionId'];
            isOneToOne: false;
            referencedRelation: 'raw_item_versions';
            referencedColumns: ['id'];
          },
        ];
      };
      raw_item_versions: {
        Row: {
          contentHash: string;
          createdAt: string;
          firstBatchId: string;
          firstSeenAt: string;
          id: string;
          lastSeenAt: string;
          payload: NonNullable<Json>;
          rawItemId: string;
        };
        ComputedFields: never;
        Insert: {
          contentHash: string;
          createdAt?: string;
          firstBatchId: string;
          firstSeenAt: string;
          id: string;
          lastSeenAt: string;
          payload: NonNullable<Json>;
          rawItemId: string;
        };
        Update: {
          contentHash?: string;
          createdAt?: string;
          firstBatchId?: string;
          firstSeenAt?: string;
          id?: string;
          lastSeenAt?: string;
          payload?: NonNullable<Json>;
          rawItemId?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'raw_item_versions_firstBatchId_fkey';
            columns: ['firstBatchId'];
            isOneToOne: false;
            referencedRelation: 'collection_batches';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'raw_item_versions_rawItemId_fkey';
            columns: ['rawItemId'];
            isOneToOne: false;
            referencedRelation: 'raw_items';
            referencedColumns: ['id'];
          },
        ];
      };
      raw_items: {
        Row: {
          channel: string;
          firstSeenAt: string;
          id: string;
          kind: string;
          lastSeenAt: string;
          latestVersionId: string | null;
          sourceKey: string;
        };
        ComputedFields: never;
        Insert: {
          channel: string;
          firstSeenAt: string;
          id: string;
          kind: string;
          lastSeenAt: string;
          latestVersionId?: string | null;
          sourceKey: string;
        };
        Update: {
          channel?: string;
          firstSeenAt?: string;
          id?: string;
          kind?: string;
          lastSeenAt?: string;
          latestVersionId?: string | null;
          sourceKey?: string;
        };
        Relationships: [];
      };
      region_countries: {
        Row: {
          countryCode: string;
          regionCode: string;
        };
        ComputedFields: never;
        Insert: {
          countryCode: string;
          regionCode: string;
        };
        Update: {
          countryCode?: string;
          regionCode?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'region_countries_countryCode_fkey';
            columns: ['countryCode'];
            isOneToOne: false;
            referencedRelation: 'countries';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'region_countries_regionCode_fkey';
            columns: ['regionCode'];
            isOneToOne: false;
            referencedRelation: 'regions';
            referencedColumns: ['code'];
          },
        ];
      };
      regions: {
        Row: {
          aliases: string[];
          approvedAt: string | null;
          code: string;
          firstSeenAt: string;
          label: string;
          occurrences: number;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          aliases: string[];
          approvedAt?: string | null;
          code: string;
          firstSeenAt: string;
          label: string;
          occurrences?: number;
          status: string;
        };
        Update: {
          aliases?: string[];
          approvedAt?: string | null;
          code?: string;
          firstSeenAt?: string;
          label?: string;
          occurrences?: number;
          status?: string;
        };
        Relationships: [];
      };
      role_kinds: {
        Row: {
          aliases: string[];
          approvedAt: string | null;
          code: string;
          firstSeenAt: string;
          isEngineering: boolean;
          label: string;
          occurrences: number;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          aliases: string[];
          approvedAt?: string | null;
          code: string;
          firstSeenAt: string;
          isEngineering?: boolean;
          label: string;
          occurrences?: number;
          status: string;
        };
        Update: {
          aliases?: string[];
          approvedAt?: string | null;
          code?: string;
          firstSeenAt?: string;
          isEngineering?: boolean;
          label?: string;
          occurrences?: number;
          status?: string;
        };
        Relationships: [];
      };
      search_segment_runs: {
        Row: {
          apifyRunId: string | null;
          capped: boolean;
          channel: string;
          costFinalAt: string | null;
          costMicroUsd: number | null;
          error: string | null;
          fetched: number;
          finishedAt: string;
          id: string;
          perQuery: NonNullable<Json>;
          queryIds: string[];
          searchTotals: Json | null;
          segmentHash: string;
          segmentKey: string;
          startedAt: string;
          status: string;
          truncatedQueryIds: string[];
          windowEnd: string;
          windowStart: string;
        };
        ComputedFields: never;
        Insert: {
          apifyRunId?: string | null;
          capped: boolean;
          channel: string;
          costFinalAt?: string | null;
          costMicroUsd?: number | null;
          error?: string | null;
          fetched: number;
          finishedAt: string;
          id: string;
          perQuery: NonNullable<Json>;
          queryIds: string[];
          searchTotals?: Json | null;
          segmentHash: string;
          segmentKey: string;
          startedAt: string;
          status: string;
          truncatedQueryIds: string[];
          windowEnd: string;
          windowStart: string;
        };
        Update: {
          apifyRunId?: string | null;
          capped?: boolean;
          channel?: string;
          costFinalAt?: string | null;
          costMicroUsd?: number | null;
          error?: string | null;
          fetched?: number;
          finishedAt?: string;
          id?: string;
          perQuery?: NonNullable<Json>;
          queryIds?: string[];
          searchTotals?: Json | null;
          segmentHash?: string;
          segmentKey?: string;
          startedAt?: string;
          status?: string;
          truncatedQueryIds?: string[];
          windowEnd?: string;
          windowStart?: string;
        };
        Relationships: [];
      };
      seniorities: {
        Row: {
          aliases: string[];
          approvedAt: string | null;
          code: string;
          firstSeenAt: string;
          label: string;
          occurrences: number;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          aliases: string[];
          approvedAt?: string | null;
          code: string;
          firstSeenAt: string;
          label: string;
          occurrences?: number;
          status: string;
        };
        Update: {
          aliases?: string[];
          approvedAt?: string | null;
          code?: string;
          firstSeenAt?: string;
          label?: string;
          occurrences?: number;
          status?: string;
        };
        Relationships: [];
      };
      silenced_authors: {
        Row: {
          authorKey: string;
          createdAt: string;
          createdBy: string | null;
          evidence: Json | null;
          id: string;
          name: string | null;
          origin: string;
          reason: string;
        };
        ComputedFields: never;
        Insert: {
          authorKey: string;
          createdAt?: string;
          createdBy?: string | null;
          evidence?: Json | null;
          id: string;
          name?: string | null;
          origin: string;
          reason: string;
        };
        Update: {
          authorKey?: string;
          createdAt?: string;
          createdBy?: string | null;
          evidence?: Json | null;
          id?: string;
          name?: string | null;
          origin?: string;
          reason?: string;
        };
        Relationships: [];
      };
      tech_tags: {
        Row: {
          aliases: string[];
          approvedAt: string | null;
          code: string;
          family: string | null;
          firstSeenAt: string;
          implies: string[];
          label: string;
          occurrences: number;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          aliases: string[];
          approvedAt?: string | null;
          code: string;
          family?: string | null;
          firstSeenAt: string;
          implies: string[];
          label: string;
          occurrences?: number;
          status: string;
        };
        Update: {
          aliases?: string[];
          approvedAt?: string | null;
          code?: string;
          family?: string | null;
          firstSeenAt?: string;
          implies?: string[];
          label?: string;
          occurrences?: number;
          status?: string;
        };
        Relationships: [];
      };
      users: {
        Row: {
          acceptsSponsorship: boolean | null;
          address: Json | null;
          createdAt: string;
          eligibilityVersion: number;
          id: string;
          name: string | null;
          residenceCountry: string | null;
          searchesResumedAt: string | null;
          updatedAt: string;
        };
        ComputedFields: never;
        Insert: {
          acceptsSponsorship?: boolean | null;
          address?: Json | null;
          createdAt?: string;
          eligibilityVersion?: number;
          id: string;
          name?: string | null;
          residenceCountry?: string | null;
          searchesResumedAt?: string | null;
          updatedAt?: string;
        };
        Update: {
          acceptsSponsorship?: boolean | null;
          address?: Json | null;
          createdAt?: string;
          eligibilityVersion?: number;
          id?: string;
          name?: string | null;
          residenceCountry?: string | null;
          searchesResumedAt?: string | null;
          updatedAt?: string;
        };
        Relationships: [];
      };
      webhook_deliveries: {
        Row: {
          attempts: number;
          createdAt: string;
          deliveredAt: string | null;
          id: string;
          jobId: string | null;
          kind: string;
          lastError: string | null;
          lastStatusCode: number | null;
          matchId: string | null;
          nextAttemptAt: string;
          payload: Json | null;
          profileId: string | null;
          status: string;
          trigger: string | null;
          updatedAt: string;
          userId: string;
          webhookId: string;
        };
        ComputedFields: never;
        Insert: {
          attempts?: number;
          createdAt?: string;
          deliveredAt?: string | null;
          id?: string;
          jobId?: string | null;
          kind: string;
          lastError?: string | null;
          lastStatusCode?: number | null;
          matchId?: string | null;
          nextAttemptAt?: string;
          payload?: Json | null;
          profileId?: string | null;
          status?: string;
          trigger?: string | null;
          updatedAt?: string;
          userId: string;
          webhookId: string;
        };
        Update: {
          attempts?: number;
          createdAt?: string;
          deliveredAt?: string | null;
          id?: string;
          jobId?: string | null;
          kind?: string;
          lastError?: string | null;
          lastStatusCode?: number | null;
          matchId?: string | null;
          nextAttemptAt?: string;
          payload?: Json | null;
          profileId?: string | null;
          status?: string;
          trigger?: string | null;
          updatedAt?: string;
          userId?: string;
          webhookId?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'webhook_deliveries_jobId_fkey';
            columns: ['jobId'];
            isOneToOne: false;
            referencedRelation: 'normalized_jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'webhook_deliveries_matchId_fkey';
            columns: ['matchId'];
            isOneToOne: false;
            referencedRelation: 'job_matches';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'webhook_deliveries_profileId_userId_fkey';
            columns: ['profileId', 'userId'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id', 'userId'];
          },
          {
            foreignKeyName: 'webhook_deliveries_userId_fkey';
            columns: ['userId'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'webhook_deliveries_webhookId_userId_fkey';
            columns: ['webhookId', 'userId'];
            isOneToOne: false;
            referencedRelation: 'webhooks';
            referencedColumns: ['id', 'userId'];
          },
        ];
      };
      webhooks: {
        Row: {
          consecutiveFailures: number;
          createdAt: string;
          disabledReason: string | null;
          enabled: boolean;
          enabledSince: string;
          id: string;
          lastFailureAt: string | null;
          lastSuccessAt: string | null;
          secret: string;
          updatedAt: string;
          url: string;
          userId: string;
        };
        ComputedFields: never;
        Insert: {
          consecutiveFailures?: number;
          createdAt?: string;
          disabledReason?: string | null;
          enabled?: boolean;
          enabledSince?: string;
          id?: string;
          lastFailureAt?: string | null;
          lastSuccessAt?: string | null;
          secret?: string;
          updatedAt?: string;
          url: string;
          userId: string;
        };
        Update: {
          consecutiveFailures?: number;
          createdAt?: string;
          disabledReason?: string | null;
          enabled?: boolean;
          enabledSince?: string;
          id?: string;
          lastFailureAt?: string | null;
          lastSuccessAt?: string | null;
          secret?: string;
          updatedAt?: string;
          url?: string;
          userId?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'webhooks_userId_fkey';
            columns: ['userId'];
            isOneToOne: true;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      work_authorizations: {
        Row: {
          createdAt: string;
          id: string;
          kind: string;
          place: string;
          updatedAt: string;
          userId: string;
        };
        ComputedFields: never;
        Insert: {
          createdAt?: string;
          id: string;
          kind: string;
          place: string;
          updatedAt?: string;
          userId: string;
        };
        Update: {
          createdAt?: string;
          id?: string;
          kind?: string;
          place?: string;
          updatedAt?: string;
          userId?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'work_authorizations_userId_fkey';
            columns: ['userId'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      assert_codes: {
        Args: { codes: string[]; field: string; list: string };
        Returns: undefined;
      };
      assert_languages: {
        Args: { field: string; langs: Json };
        Returns: undefined;
      };
      assert_places: {
        Args: { field: string; places: Json };
        Returns: undefined;
      };
      create_profile_from_draft: {
        Args: { p_profile: Json; p_profile_id: string; p_skills: Json };
        Returns: string;
      };
      create_profile_from_setup: {
        Args: { p_profile: Json; p_skills: Json };
        Returns: string;
      };
      end_expired_sessions: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      job_decision_list: {
        Args: Record<PropertyKey, never>;
        Returns: {
          applyUrl: string;
          channels: string[];
          closed: boolean;
          companyName: string;
          decidedAt: string;
          hasMatch: boolean;
          jobId: string;
          kind: string;
          location: string;
          note: string;
          postedAt: string;
          postingUrl: string;
          publishedAt: string;
          reason: string;
          status: string;
          title: string;
        }[];
      };
      job_postings: {
        Args: { p_job_id: string };
        Returns: {
          channel: string;
          descriptionDiffers: boolean;
          location: string;
          placeDiffers: boolean;
          postedAt: string;
          postingUrl: string;
          rawItemId: string;
          shown: boolean;
          title: string;
          titleDiffers: boolean;
        }[];
      };
      match_details: {
        Args: {
          p_details?: boolean;
          p_job_id?: string;
          p_kind?: string;
          p_outcome?: string;
          p_profile_id?: string;
          p_since?: string;
        };
        Returns: {
          applyUrl: string;
          channels: string[];
          checks: Json;
          closed: boolean;
          companyName: string;
          companyUrl: string;
          conflicts: Json;
          decidedAt: string;
          decisionStatus: string;
          descriptionText: string;
          extractionId: string;
          facts: Json;
          firstSeenAt: string;
          jobId: string;
          kind: string;
          lastSeenAt: string;
          location: string;
          matchId: string;
          outcome: string;
          postedAt: string;
          posterName: string;
          posterProfileUrl: string;
          posterType: string;
          postingUrl: string;
          profileId: string;
          publishedAt: string;
          reviewChoice: string;
          reviewField: string;
          reviewRule: string;
          salaryCurrency: string;
          salaryMax: number;
          salaryMin: number;
          salaryPeriod: string;
          salaryText: string;
          stackScore: number;
          title: string;
          unverified: boolean;
          viewedAt: string;
        }[];
      };
      replace_profile_skills: {
        Args: { p_profile_id: string; p_skills: Json };
        Returns: undefined;
      };
      resume_folder_is_own: { Args: { object_name: string }; Returns: boolean };
      resume_key_is_own: { Args: { object_name: string }; Returns: boolean };
      set_profile_resume: {
        Args: {
          filename: string;
          key: string;
          profile_id: string;
          sha256: string;
        };
        Returns: string;
      };
      webhook_delete: { Args: Record<PropertyKey, never>; Returns: undefined };
      webhook_enqueue_match: {
        Args: { p_match_id: string; p_trigger: string };
        Returns: string;
      };
      webhook_rotate_secret: {
        Args: Record<PropertyKey, never>;
        Returns: undefined;
      };
      webhook_save: { Args: { p_url: string }; Returns: undefined };
      webhook_send_test: { Args: Record<PropertyKey, never>; Returns: string };
      webhook_set_enabled: { Args: { p_enabled: boolean }; Returns: undefined };
      webhook_url_ok: { Args: { p_url: string }; Returns: boolean };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  'public'
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] &
        DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] &
        DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
