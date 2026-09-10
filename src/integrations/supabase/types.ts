export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          account_type: string
          broker: string | null
          buying_power: number
          cash: number
          created_at: string
          id: string
          last_synced_at: string | null
          margin_limit: number
          margin_used: number
          name: string
          notes: string | null
          starting_value: number
          target_date: string | null
          target_value: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_type?: string
          broker?: string | null
          buying_power?: number
          cash?: number
          created_at?: string
          id?: string
          last_synced_at?: string | null
          margin_limit?: number
          margin_used?: number
          name?: string
          notes?: string | null
          starting_value?: number
          target_date?: string | null
          target_value?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_type?: string
          broker?: string | null
          buying_power?: number
          cash?: number
          created_at?: string
          id?: string
          last_synced_at?: string | null
          margin_limit?: number
          margin_used?: number
          name?: string
          notes?: string | null
          starting_value?: number
          target_date?: string | null
          target_value?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      decisions: {
        Row: {
          action: string | null
          confidence: number | null
          counterargument: string | null
          created_at: string
          decided_on: string
          decision: string
          evidence: Json | null
          grade: string | null
          id: string
          invalidation_conditions: Json | null
          key_risks: Json | null
          outcome: string | null
          outcome_1d: number | null
          outcome_1m: number | null
          outcome_1w: number | null
          outcome_pl: number | null
          portfolio_impact: Json | null
          price_at_rec: number | null
          probability_impact: Json | null
          recommendation: string
          review_type: string
          symbol: string | null
          user_id: string
        }
        Insert: {
          action?: string | null
          confidence?: number | null
          counterargument?: string | null
          created_at?: string
          decided_on?: string
          decision?: string
          evidence?: Json | null
          grade?: string | null
          id?: string
          invalidation_conditions?: Json | null
          key_risks?: Json | null
          outcome?: string | null
          outcome_1d?: number | null
          outcome_1m?: number | null
          outcome_1w?: number | null
          outcome_pl?: number | null
          portfolio_impact?: Json | null
          price_at_rec?: number | null
          probability_impact?: Json | null
          recommendation: string
          review_type?: string
          symbol?: string | null
          user_id: string
        }
        Update: {
          action?: string | null
          confidence?: number | null
          counterargument?: string | null
          created_at?: string
          decided_on?: string
          decision?: string
          evidence?: Json | null
          grade?: string | null
          id?: string
          invalidation_conditions?: Json | null
          key_risks?: Json | null
          outcome?: string | null
          outcome_1d?: number | null
          outcome_1m?: number | null
          outcome_1w?: number | null
          outcome_pl?: number | null
          portfolio_impact?: Json | null
          price_at_rec?: number | null
          probability_impact?: Json | null
          recommendation?: string
          review_type?: string
          symbol?: string | null
          user_id?: string
        }
        Relationships: []
      }
      goals: {
        Row: {
          created_at: string
          id: string
          is_primary: boolean
          margin_preference: string
          monthly_contribution: number
          name: string
          risk_preference: string
          starting_value: number
          target_date: string
          target_value: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_primary?: boolean
          margin_preference?: string
          monthly_contribution?: number
          name?: string
          risk_preference?: string
          starting_value?: number
          target_date?: string
          target_value?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_primary?: boolean
          margin_preference?: string
          monthly_contribution?: number
          name?: string
          risk_preference?: string
          starting_value?: number
          target_date?: string
          target_value?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      holdings: {
        Row: {
          account_id: string | null
          cost_basis: number
          created_at: string
          current_price: number
          current_thesis: string | null
          id: string
          last_ai_review: string | null
          last_price_at: string | null
          last_reviewed_at: string | null
          notes: string | null
          original_thesis: string | null
          quantity: number
          sector: string | null
          symbol: string
          updated_at: string
          user_id: string
          why_own: string | null
        }
        Insert: {
          account_id?: string | null
          cost_basis?: number
          created_at?: string
          current_price?: number
          current_thesis?: string | null
          id?: string
          last_ai_review?: string | null
          last_price_at?: string | null
          last_reviewed_at?: string | null
          notes?: string | null
          original_thesis?: string | null
          quantity?: number
          sector?: string | null
          symbol: string
          updated_at?: string
          user_id: string
          why_own?: string | null
        }
        Update: {
          account_id?: string | null
          cost_basis?: number
          created_at?: string
          current_price?: number
          current_thesis?: string | null
          id?: string
          last_ai_review?: string | null
          last_price_at?: string | null
          last_reviewed_at?: string | null
          notes?: string | null
          original_thesis?: string | null
          quantity?: number
          sector?: string | null
          symbol?: string
          updated_at?: string
          user_id?: string
          why_own?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "holdings_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      investment_universe: {
        Row: {
          business_quality: number | null
          catalysts: string | null
          company_name: string | null
          created_at: string
          geopolitical_exposure: number | null
          growth: number | null
          id: string
          last_scored_at: string | null
          macro_sensitivity: number | null
          overall_conviction: number | null
          relative_strength: number | null
          replaces_symbol: string | null
          risk: number | null
          symbol: string
          technical_strength: number | null
          thesis: string | null
          tier: string
          user_id: string
          valuation: number | null
        }
        Insert: {
          business_quality?: number | null
          catalysts?: string | null
          company_name?: string | null
          created_at?: string
          geopolitical_exposure?: number | null
          growth?: number | null
          id?: string
          last_scored_at?: string | null
          macro_sensitivity?: number | null
          overall_conviction?: number | null
          relative_strength?: number | null
          replaces_symbol?: string | null
          risk?: number | null
          symbol: string
          technical_strength?: number | null
          thesis?: string | null
          tier?: string
          user_id: string
          valuation?: number | null
        }
        Update: {
          business_quality?: number | null
          catalysts?: string | null
          company_name?: string | null
          created_at?: string
          geopolitical_exposure?: number | null
          growth?: number | null
          id?: string
          last_scored_at?: string | null
          macro_sensitivity?: number | null
          overall_conviction?: number | null
          relative_strength?: number | null
          replaces_symbol?: string | null
          risk?: number | null
          symbol?: string
          technical_strength?: number | null
          thesis?: string | null
          tier?: string
          user_id?: string
          valuation?: number | null
        }
        Relationships: []
      }
      journal_entries: {
        Row: {
          ai_summary: string | null
          body: string
          created_at: string
          entry_type: string
          id: string
          source: string
          tags: string[]
          tickers: string[]
          title: string | null
          user_id: string
        }
        Insert: {
          ai_summary?: string | null
          body?: string
          created_at?: string
          entry_type: string
          id?: string
          source?: string
          tags?: string[]
          tickers?: string[]
          title?: string | null
          user_id: string
        }
        Update: {
          ai_summary?: string | null
          body?: string
          created_at?: string
          entry_type?: string
          id?: string
          source?: string
          tags?: string[]
          tickers?: string[]
          title?: string | null
          user_id?: string
        }
        Relationships: []
      }
      portfolio_snapshots: {
        Row: {
          created_at: string
          gross: number
          id: string
          margin_used: number
          net: number
          scope: string
          user_id: string
        }
        Insert: {
          created_at?: string
          gross?: number
          id?: string
          margin_used?: number
          net?: number
          scope?: string
          user_id: string
        }
        Update: {
          created_at?: string
          gross?: number
          id?: string
          margin_used?: number
          net?: number
          scope?: string
          user_id?: string
        }
        Relationships: []
      }
      price_history: {
        Row: {
          close: number
          created_at: string
          date: string
          id: string
          source: string
          symbol: string
          user_id: string
          volume: number | null
        }
        Insert: {
          close: number
          created_at?: string
          date: string
          id?: string
          source?: string
          symbol: string
          user_id: string
          volume?: number | null
        }
        Update: {
          close?: number
          created_at?: string
          date?: string
          id?: string
          source?: string
          symbol?: string
          user_id?: string
          volume?: number | null
        }
        Relationships: []
      }
      priorities: {
        Row: {
          active: boolean
          created_at: string
          id: string
          label: string
          severity: string
          source: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          label: string
          severity?: string
          source?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          label?: string
          severity?: string
          source?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      recommended_actions: {
        Row: {
          active: boolean
          category: string
          created_at: string
          id: string
          rationale: string | null
          source: string
          symbol: string | null
          user_id: string
        }
        Insert: {
          active?: boolean
          category: string
          created_at?: string
          id?: string
          rationale?: string | null
          source?: string
          symbol?: string | null
          user_id: string
        }
        Update: {
          active?: boolean
          category?: string
          created_at?: string
          id?: string
          rationale?: string | null
          source?: string
          symbol?: string | null
          user_id?: string
        }
        Relationships: []
      }
      server_request_limits: {
        Row: {
          request_count: number
          scope: string
          user_id: string
          window_started_at: string
        }
        Insert: {
          request_count?: number
          scope: string
          user_id: string
          window_started_at: string
        }
        Update: {
          request_count?: number
          scope?: string
          user_id?: string
          window_started_at?: string
        }
        Relationships: []
      }
      sync_log: {
        Row: {
          created_at: string
          detail: string | null
          id: string
          source: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          detail?: string | null
          id?: string
          source?: string
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          detail?: string | null
          id?: string
          source?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      watchlist: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          symbol: string
          target_price: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          symbol: string
          target_price?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          symbol?: string
          target_price?: number | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      consume_provider_request_limit: {
        Args: { p_scope: string }
        Returns: {
          allowed: boolean
          remaining: number
          retry_after_seconds: number
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
