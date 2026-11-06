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
      job_extractions: {
        Row: {
          arrangement: string | null;
          cityIds: string[];
          contractType: string | null;
          costUsd: number;
          countryCodes: string[];
          createdAt: string;
          data: NonNullable<Json>;
          decisionModel: string;
          engagement: string | null;
          extractionModel: string;
          id: string;
          inputHash: string;
          isSoftwareEngineeringRole: boolean | null;
          jobId: string;
          mainStackTags: string[];
          needsReview: boolean;
          promptHash: string;
          regionCodes: string[];
          roleKind: string | null;
          salaryCurrency: string | null;
          salaryMax: number | null;
          salaryMin: number | null;
          salaryPeriod: string | null;
          schemaVersion: number;
          seniority: string | null;
          techTags: string[];
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
          decisionModel: string;
          engagement?: string | null;
          extractionModel: string;
          id: string;
          inputHash: string;
          isSoftwareEngineeringRole?: boolean | null;
          jobId: string;
          mainStackTags: string[];
          needsReview: boolean;
          promptHash: string;
          regionCodes: string[];
          roleKind?: string | null;
          salaryCurrency?: string | null;
          salaryMax?: number | null;
          salaryMin?: number | null;
          salaryPeriod?: string | null;
          schemaVersion: number;
          seniority?: string | null;
          techTags: string[];
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
          decisionModel?: string;
          engagement?: string | null;
          extractionModel?: string;
          id?: string;
          inputHash?: string;
          isSoftwareEngineeringRole?: boolean | null;
          jobId?: string;
          mainStackTags?: string[];
          needsReview?: boolean;
          promptHash?: string;
          regionCodes?: string[];
          roleKind?: string | null;
          salaryCurrency?: string | null;
          salaryMax?: number | null;
          salaryMin?: number | null;
          salaryPeriod?: string | null;
          schemaVersion?: number;
          seniority?: string | null;
          techTags?: string[];
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
          applyUrl: string | null;
          closed: boolean;
          companyName: string | null;
          companyUrl: string | null;
          contractType: string | null;
          createdAt: string;
          currentExtractionId: string | null;
          descriptionHtml: string | null;
          descriptionText: string | null;
          experienceLevel: string | null;
          fieldSources: NonNullable<Json>;
          firstSeenAt: string;
          id: string;
          jobKey: string;
          kind: string;
          lastSeenAt: string;
          location: string | null;
          mergedIntoId: string | null;
          normalizerVersion: number;
          posterName: string | null;
          posterProfileUrl: string | null;
          posterType: string | null;
          postingUrl: string;
          processedAt: string | null;
          processingAttempts: number;
          processingError: string | null;
          processingReason: string | null;
          processingRequestedAt: string | null;
          processingStartedAt: string | null;
          processingStatus: string | null;
          publishedAt: string | null;
          salaryCurrency: string | null;
          salaryMax: number | null;
          salaryMin: number | null;
          salaryPeriod: string | null;
          salaryText: string | null;
          sector: string | null;
          status: string;
          title: string | null;
          updatedAt: string;
        };
        ComputedFields: never;
        Insert: {
          applyUrl?: string | null;
          closed: boolean;
          companyName?: string | null;
          companyUrl?: string | null;
          contractType?: string | null;
          createdAt?: string;
          currentExtractionId?: string | null;
          descriptionHtml?: string | null;
          descriptionText?: string | null;
          experienceLevel?: string | null;
          fieldSources: NonNullable<Json>;
          firstSeenAt: string;
          id: string;
          jobKey: string;
          kind: string;
          lastSeenAt: string;
          location?: string | null;
          mergedIntoId?: string | null;
          normalizerVersion: number;
          posterName?: string | null;
          posterProfileUrl?: string | null;
          posterType?: string | null;
          postingUrl: string;
          processedAt?: string | null;
          processingAttempts?: number;
          processingError?: string | null;
          processingReason?: string | null;
          processingRequestedAt?: string | null;
          processingStartedAt?: string | null;
          processingStatus?: string | null;
          publishedAt?: string | null;
          salaryCurrency?: string | null;
          salaryMax?: number | null;
          salaryMin?: number | null;
          salaryPeriod?: string | null;
          salaryText?: string | null;
          sector?: string | null;
          status: string;
          title?: string | null;
          updatedAt?: string;
        };
        Update: {
          applyUrl?: string | null;
          closed?: boolean;
          companyName?: string | null;
          companyUrl?: string | null;
          contractType?: string | null;
          createdAt?: string;
          currentExtractionId?: string | null;
          descriptionHtml?: string | null;
          descriptionText?: string | null;
          experienceLevel?: string | null;
          fieldSources?: NonNullable<Json>;
          firstSeenAt?: string;
          id?: string;
          jobKey?: string;
          kind?: string;
          lastSeenAt?: string;
          location?: string | null;
          mergedIntoId?: string | null;
          normalizerVersion?: number;
          posterName?: string | null;
          posterProfileUrl?: string | null;
          posterType?: string | null;
          postingUrl?: string;
          processedAt?: string | null;
          processingAttempts?: number;
          processingError?: string | null;
          processingReason?: string | null;
          processingRequestedAt?: string | null;
          processingStartedAt?: string | null;
          processingStatus?: string | null;
          publishedAt?: string | null;
          salaryCurrency?: string | null;
          salaryMax?: number | null;
          salaryMin?: number | null;
          salaryPeriod?: string | null;
          salaryText?: string | null;
          sector?: string | null;
          status?: string;
          title?: string | null;
          updatedAt?: string;
        };
        Relationships: [
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
          city: string | null;
          contractTypes: string[] | null;
          country: string | null;
          createdAt: string;
          engagements: string[];
          id: string;
          languages: string[] | null;
          locations: Json | null;
          noticePeriodDays: number;
          places: Json | null;
          position: string;
          publishedAt: string | null;
          resumeFilename: string | null;
          resumeKey: string | null;
          resumeSha256: string | null;
          resumeSizeBytes: number | null;
          resumeUploadedAt: string | null;
          salaryCurrency: string | null;
          salaryMin: number | null;
          salaryPeriod: string | null;
          seniorities: string[];
          spokenLanguages: Json | null;
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
          city?: string | null;
          contractTypes?: string[] | null;
          country?: string | null;
          createdAt?: string;
          engagements: string[];
          id: string;
          languages?: string[] | null;
          locations?: Json | null;
          noticePeriodDays: number;
          places?: Json | null;
          position: string;
          publishedAt?: string | null;
          resumeFilename?: string | null;
          resumeKey?: string | null;
          resumeSha256?: string | null;
          resumeSizeBytes?: number | null;
          resumeUploadedAt?: string | null;
          salaryCurrency?: string | null;
          salaryMin?: number | null;
          salaryPeriod?: string | null;
          seniorities: string[];
          spokenLanguages?: Json | null;
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
          city?: string | null;
          contractTypes?: string[] | null;
          country?: string | null;
          createdAt?: string;
          engagements?: string[];
          id?: string;
          languages?: string[] | null;
          locations?: Json | null;
          noticePeriodDays?: number;
          places?: Json | null;
          position?: string;
          publishedAt?: string | null;
          resumeFilename?: string | null;
          resumeKey?: string | null;
          resumeSha256?: string | null;
          resumeSizeBytes?: number | null;
          resumeUploadedAt?: string | null;
          salaryCurrency?: string | null;
          salaryMin?: number | null;
          salaryPeriod?: string | null;
          seniorities?: string[];
          spokenLanguages?: Json | null;
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
          capped: boolean;
          channel: string;
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
          capped: boolean;
          channel: string;
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
          capped?: boolean;
          channel?: string;
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
          id: string;
          name: string | null;
          residenceCountry: string | null;
          updatedAt: string;
        };
        ComputedFields: never;
        Insert: {
          acceptsSponsorship?: boolean | null;
          address?: Json | null;
          createdAt?: string;
          id: string;
          name?: string | null;
          residenceCountry?: string | null;
          updatedAt?: string;
        };
        Update: {
          acceptsSponsorship?: boolean | null;
          address?: Json | null;
          createdAt?: string;
          id?: string;
          name?: string | null;
          residenceCountry?: string | null;
          updatedAt?: string;
        };
        Relationships: [];
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
      end_expired_sessions: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
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
