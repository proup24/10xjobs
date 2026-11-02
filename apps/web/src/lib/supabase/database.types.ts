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
      ats_posting_identities: {
        Row: {
          id: string;
          postingId: string;
          provider: string;
          tenantKey: string;
        };
        ComputedFields: never;
        Insert: {
          id: string;
          postingId: string;
          provider: string;
          tenantKey: string;
        };
        Update: {
          id?: string;
          postingId?: string;
          provider?: string;
          tenantKey?: string;
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
        };
        Relationships: [
          {
            foreignKeyName: 'profile_skills_profileId_fkey';
            columns: ['profileId'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          arrangements: string[];
          city: string | null;
          country: string;
          createdAt: string;
          engagements: string[];
          id: string;
          languages: string[];
          noticePeriodDays: number;
          position: string;
          publishedAt: string | null;
          regions: string[];
          resumeFilename: string | null;
          resumeKey: string | null;
          resumeSha256: string | null;
          resumeSizeBytes: number | null;
          resumeUploadedAt: string | null;
          seniority: string;
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
          arrangements: string[];
          city?: string | null;
          country: string;
          createdAt?: string;
          engagements: string[];
          id: string;
          languages: string[];
          noticePeriodDays: number;
          position: string;
          publishedAt?: string | null;
          regions: string[];
          resumeFilename?: string | null;
          resumeKey?: string | null;
          resumeSha256?: string | null;
          resumeSizeBytes?: number | null;
          resumeUploadedAt?: string | null;
          seniority: string;
          state?: string;
          timezoneCurrent: number;
          timezoneMax: number;
          timezoneMin: number;
          updatedAt?: string;
          userId: string;
          yearsOfExperience: number;
        };
        Update: {
          arrangements?: string[];
          city?: string | null;
          country?: string;
          createdAt?: string;
          engagements?: string[];
          id?: string;
          languages?: string[];
          noticePeriodDays?: number;
          position?: string;
          publishedAt?: string | null;
          regions?: string[];
          resumeFilename?: string | null;
          resumeKey?: string | null;
          resumeSha256?: string | null;
          resumeSizeBytes?: number | null;
          resumeUploadedAt?: string | null;
          seniority?: string;
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
          city: string | null;
          country: string | null;
          createdAt: string;
          experience: string;
          hash: string;
          id: string;
          isActive: boolean;
          isDeleted: boolean;
          keyword: string;
          locationRegion: string | null;
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
          city?: string | null;
          country?: string | null;
          createdAt?: string;
          experience: string;
          hash: string;
          id: string;
          isActive?: boolean;
          isDeleted?: boolean;
          keyword: string;
          locationRegion?: string | null;
          params: NonNullable<Json>;
          technologies: string[];
          type: string;
          updatedAt?: string;
          version: number;
        };
        Update: {
          associatedProfiles?: number;
          channel?: string;
          city?: string | null;
          country?: string | null;
          createdAt?: string;
          experience?: string;
          hash?: string;
          id?: string;
          isActive?: boolean;
          isDeleted?: boolean;
          keyword?: string;
          locationRegion?: string | null;
          params?: NonNullable<Json>;
          technologies?: string[];
          type?: string;
          updatedAt?: string;
          version?: number;
        };
        Relationships: [];
      };
      raw_job_identities: {
        Row: {
          channel: string;
          id: string;
          identityType: string;
          identityValue: string;
          rawJobId: string;
        };
        ComputedFields: never;
        Insert: {
          channel: string;
          id: string;
          identityType: string;
          identityValue: string;
          rawJobId: string;
        };
        Update: {
          channel?: string;
          id?: string;
          identityType?: string;
          identityValue?: string;
          rawJobId?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'raw_job_identities_rawJobId_fkey';
            columns: ['rawJobId'];
            isOneToOne: false;
            referencedRelation: 'raw_jobs';
            referencedColumns: ['id'];
          },
        ];
      };
      raw_job_query_hits: {
        Row: {
          firstSeenAt: string;
          id: string;
          lastSeenAt: string;
          observedUrl: string;
          queryId: string;
          rank: number | null;
          rawJobId: string;
        };
        ComputedFields: never;
        Insert: {
          firstSeenAt: string;
          id: string;
          lastSeenAt: string;
          observedUrl: string;
          queryId: string;
          rank?: number | null;
          rawJobId: string;
        };
        Update: {
          firstSeenAt?: string;
          id?: string;
          lastSeenAt?: string;
          observedUrl?: string;
          queryId?: string;
          rank?: number | null;
          rawJobId?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'raw_job_query_hits_queryId_fkey';
            columns: ['queryId'];
            isOneToOne: false;
            referencedRelation: 'query_search_builder';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'raw_job_query_hits_rawJobId_fkey';
            columns: ['rawJobId'];
            isOneToOne: false;
            referencedRelation: 'raw_jobs';
            referencedColumns: ['id'];
          },
        ];
      };
      raw_jobs: {
        Row: {
          applyUrl: string | null;
          atsPostingId: string | null;
          authorName: string | null;
          authorUrl: string | null;
          channel: string;
          company: string | null;
          contactName: string | null;
          contactUrl: string | null;
          description: string;
          externalId: string | null;
          firstSeenAt: string;
          id: string;
          kind: string;
          lastSeenAt: string;
          location: string | null;
          normalizationVersion: number;
          postedAt: string | null;
          postedAtPrecision: string | null;
          raw: NonNullable<Json>;
          title: string | null;
          url: string;
        };
        ComputedFields: never;
        Insert: {
          applyUrl?: string | null;
          atsPostingId?: string | null;
          authorName?: string | null;
          authorUrl?: string | null;
          channel: string;
          company?: string | null;
          contactName?: string | null;
          contactUrl?: string | null;
          description: string;
          externalId?: string | null;
          firstSeenAt: string;
          id: string;
          kind: string;
          lastSeenAt: string;
          location?: string | null;
          normalizationVersion: number;
          postedAt?: string | null;
          postedAtPrecision?: string | null;
          raw: NonNullable<Json>;
          title?: string | null;
          url: string;
        };
        Update: {
          applyUrl?: string | null;
          atsPostingId?: string | null;
          authorName?: string | null;
          authorUrl?: string | null;
          channel?: string;
          company?: string | null;
          contactName?: string | null;
          contactUrl?: string | null;
          description?: string;
          externalId?: string | null;
          firstSeenAt?: string;
          id?: string;
          kind?: string;
          lastSeenAt?: string;
          location?: string | null;
          normalizationVersion?: number;
          postedAt?: string | null;
          postedAtPrecision?: string | null;
          raw?: NonNullable<Json>;
          title?: string | null;
          url?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'raw_jobs_atsPostingId_fkey';
            columns: ['atsPostingId'];
            isOneToOne: false;
            referencedRelation: 'ats_posting_identities';
            referencedColumns: ['id'];
          },
        ];
      };
      users: {
        Row: {
          address: Json | null;
          createdAt: string;
          email: string;
          id: string;
          name: string;
          updatedAt: string;
        };
        ComputedFields: never;
        Insert: {
          address?: Json | null;
          createdAt?: string;
          email: string;
          id: string;
          name: string;
          updatedAt?: string;
        };
        Update: {
          address?: Json | null;
          createdAt?: string;
          email?: string;
          id?: string;
          name?: string;
          updatedAt?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
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
