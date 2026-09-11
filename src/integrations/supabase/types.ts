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
      account_balances: {
        Row: {
          account_id: string
          cash_market_value: number | null
          committed_to_open_orders: number | null
          created_at: string
          currency: string | null
          day_change: number | null
          equity_pct: number | null
          id: string
          imported_at: string
          margin_buying_power: number | null
          margin_interest_accrued_mtd: number | null
          margin_interest_rate_pct: number | null
          margin_market_value: number | null
          net_debit: number | null
          net_house_surplus: number | null
          non_margin_buying_power: number | null
          raw_text: string
          source: string | null
          source_type: string | null
          total_account_value: number | null
          user_id: string
        }
        Insert: {
          account_id: string
          cash_market_value?: number | null
          committed_to_open_orders?: number | null
          created_at?: string
          currency?: string | null
          day_change?: number | null
          equity_pct?: number | null
          id?: string
          imported_at?: string
          margin_buying_power?: number | null
          margin_interest_accrued_mtd?: number | null
          margin_interest_rate_pct?: number | null
          margin_market_value?: number | null
          net_debit?: number | null
          net_house_surplus?: number | null
          non_margin_buying_power?: number | null
          raw_text: string
          source?: string | null
          source_type?: string | null
          total_account_value?: number | null
          user_id: string
        }
        Update: {
          account_id?: string
          cash_market_value?: number | null
          committed_to_open_orders?: number | null
          created_at?: string
          currency?: string | null
          day_change?: number | null
          equity_pct?: number | null
          id?: string
          imported_at?: string
          margin_buying_power?: number | null
          margin_interest_accrued_mtd?: number | null
          margin_interest_rate_pct?: number | null
          margin_market_value?: number | null
          net_debit?: number | null
          net_house_surplus?: number | null
          non_margin_buying_power?: number | null
          raw_text?: string
          source?: string | null
          source_type?: string | null
          total_account_value?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_balances_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: {
          account_status: string | null
          account_type: string | null
          account_type_source: string | null
          balances_as_of: string | null
          balances_source: string | null
          balances_source_type: string | null
          broker: string | null
          broker_account_id: string | null
          buying_power: number | null
          cash: number | null
          cash_flows_as_of: string | null
          contribution_amount: number | null
          contribution_anchor_date: string | null
          contribution_cadence_days: number | null
          created_at: string
          currency: string | null
          household_id: string | null
          id: string
          last_synced_at: string | null
          lots_as_of: string | null
          margin_enabled: boolean | null
          margin_limit: number | null
          margin_used: number | null
          name: string
          notes: string | null
          orders_as_of: string | null
          orders_source: string | null
          owner_member_id: string | null
          starting_value: number
          target_date: string | null
          target_value: number | null
          tax_treatment: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_status?: string | null
          account_type?: string | null
          account_type_source?: string | null
          balances_as_of?: string | null
          balances_source?: string | null
          balances_source_type?: string | null
          broker?: string | null
          broker_account_id?: string | null
          buying_power?: number | null
          cash?: number | null
          cash_flows_as_of?: string | null
          contribution_amount?: number | null
          contribution_anchor_date?: string | null
          contribution_cadence_days?: number | null
          created_at?: string
          currency?: string | null
          household_id?: string | null
          id?: string
          last_synced_at?: string | null
          lots_as_of?: string | null
          margin_enabled?: boolean | null
          margin_limit?: number | null
          margin_used?: number | null
          name: string
          notes?: string | null
          orders_as_of?: string | null
          orders_source?: string | null
          owner_member_id?: string | null
          starting_value?: number
          target_date?: string | null
          target_value?: number | null
          tax_treatment?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_status?: string | null
          account_type?: string | null
          account_type_source?: string | null
          balances_as_of?: string | null
          balances_source?: string | null
          balances_source_type?: string | null
          broker?: string | null
          broker_account_id?: string | null
          buying_power?: number | null
          cash?: number | null
          cash_flows_as_of?: string | null
          contribution_amount?: number | null
          contribution_anchor_date?: string | null
          contribution_cadence_days?: number | null
          created_at?: string
          currency?: string | null
          household_id?: string | null
          id?: string
          last_synced_at?: string | null
          lots_as_of?: string | null
          margin_enabled?: boolean | null
          margin_limit?: number | null
          margin_used?: number | null
          name?: string
          notes?: string | null
          orders_as_of?: string | null
          orders_source?: string | null
          owner_member_id?: string | null
          starting_value?: number
          target_date?: string | null
          target_value?: number | null
          tax_treatment?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_owner_member_id_fkey"
            columns: ["owner_member_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_flows: {
        Row: {
          account_id: string
          amount: number
          as_of: string | null
          created_at: string
          flow_date: string
          id: string
          kind: string
          note: string | null
          source: string
          source_ref: string | null
          symbol: string | null
          treatment: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          amount: number
          as_of?: string | null
          created_at?: string
          flow_date: string
          id?: string
          kind: string
          note?: string | null
          source: string
          source_ref?: string | null
          symbol?: string | null
          treatment: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          amount?: number
          as_of?: string | null
          created_at?: string
          flow_date?: string
          id?: string
          kind?: string
          note?: string | null
          source?: string
          source_ref?: string | null
          symbol?: string | null
          treatment?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_flows_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
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
          goal_version_id: string | null
          grade: string | null
          id: string
          invalidation_conditions: Json | null
          ips_version: string | null
          key_risks: Json | null
          model_version: string | null
          objective_id: string | null
          outcome: string | null
          outcome_1d: number | null
          outcome_1m: number | null
          outcome_1w: number | null
          outcome_pl: number | null
          portfolio_impact: Json | null
          price_at_rec: number | null
          probability_impact: Json | null
          prompt_version: string | null
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
          goal_version_id?: string | null
          grade?: string | null
          id?: string
          invalidation_conditions?: Json | null
          ips_version?: string | null
          key_risks?: Json | null
          model_version?: string | null
          objective_id?: string | null
          outcome?: string | null
          outcome_1d?: number | null
          outcome_1m?: number | null
          outcome_1w?: number | null
          outcome_pl?: number | null
          portfolio_impact?: Json | null
          price_at_rec?: number | null
          probability_impact?: Json | null
          prompt_version?: string | null
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
          goal_version_id?: string | null
          grade?: string | null
          id?: string
          invalidation_conditions?: Json | null
          ips_version?: string | null
          key_risks?: Json | null
          model_version?: string | null
          objective_id?: string | null
          outcome?: string | null
          outcome_1d?: number | null
          outcome_1m?: number | null
          outcome_1w?: number | null
          outcome_pl?: number | null
          portfolio_impact?: Json | null
          price_at_rec?: number | null
          probability_impact?: Json | null
          prompt_version?: string | null
          recommendation?: string
          review_type?: string
          symbol?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "decisions_goal_version_id_fkey"
            columns: ["goal_version_id"]
            isOneToOne: false
            referencedRelation: "goal_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      goal_versions: {
        Row: {
          account_id: string | null
          baseline_type: string
          baseline_value: number | null
          contribution_plan: Json | null
          created_at: string
          effective_at: string
          goal_id: string
          id: string
          model_assumptions: Json | null
          note: string | null
          risk_constraints: Json | null
          supersedes_id: string | null
          target_date: string | null
          target_return_pct: number | null
          target_value: number | null
          user_id: string
          withdrawal_plan: Json | null
        }
        Insert: {
          account_id?: string | null
          baseline_type: string
          baseline_value?: number | null
          contribution_plan?: Json | null
          created_at?: string
          effective_at?: string
          goal_id: string
          id?: string
          model_assumptions?: Json | null
          note?: string | null
          risk_constraints?: Json | null
          supersedes_id?: string | null
          target_date?: string | null
          target_return_pct?: number | null
          target_value?: number | null
          user_id: string
          withdrawal_plan?: Json | null
        }
        Update: {
          account_id?: string | null
          baseline_type?: string
          baseline_value?: number | null
          contribution_plan?: Json | null
          created_at?: string
          effective_at?: string
          goal_id?: string
          id?: string
          model_assumptions?: Json | null
          note?: string | null
          risk_constraints?: Json | null
          supersedes_id?: string | null
          target_date?: string | null
          target_return_pct?: number | null
          target_value?: number | null
          user_id?: string
          withdrawal_plan?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "goal_versions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_versions_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_versions_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "goal_versions"
            referencedColumns: ["id"]
          },
        ]
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
          starting_value: number | null
          target_date: string | null
          target_value: number | null
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
          starting_value?: number | null
          target_date?: string | null
          target_value?: number | null
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
          starting_value?: number | null
          target_date?: string | null
          target_value?: number | null
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
          security_id: string | null
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
          security_id?: string | null
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
          security_id?: string | null
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
          {
            foreignKeyName: "holdings_security_id_fkey"
            columns: ["security_id"]
            isOneToOne: false
            referencedRelation: "securities"
            referencedColumns: ["id"]
          },
        ]
      }
      household_members: {
        Row: {
          birth_date: string | null
          created_at: string
          display_name: string
          id: string
          relationship: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          birth_date?: string | null
          created_at?: string
          display_name: string
          id?: string
          relationship?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          birth_date?: string | null
          created_at?: string
          display_name?: string
          id?: string
          relationship?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
          security_id: string | null
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
          security_id?: string | null
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
          security_id?: string | null
          symbol?: string
          technical_strength?: number | null
          thesis?: string | null
          tier?: string
          user_id?: string
          valuation?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "investment_universe_security_id_fkey"
            columns: ["security_id"]
            isOneToOne: false
            referencedRelation: "securities"
            referencedColumns: ["id"]
          },
        ]
      }
      ips_lite: {
        Row: {
          caps_source: string | null
          created_at: string
          id: string
          margin_cap_pct: number
          margin_rate_annual_pct: number | null
          margin_rate_as_of: string | null
          margin_rate_is_floating: boolean
          margin_rate_stale_days: number
          position_cap_hard: boolean
          position_cap_pct: number
          updated_at: string
          user_id: string
        }
        Insert: {
          caps_source?: string | null
          created_at?: string
          id?: string
          margin_cap_pct?: number
          margin_rate_annual_pct?: number | null
          margin_rate_as_of?: string | null
          margin_rate_is_floating?: boolean
          margin_rate_stale_days?: number
          position_cap_hard?: boolean
          position_cap_pct?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          caps_source?: string | null
          created_at?: string
          id?: string
          margin_cap_pct?: number
          margin_rate_annual_pct?: number | null
          margin_rate_as_of?: string | null
          margin_rate_is_floating?: boolean
          margin_rate_stale_days?: number
          position_cap_hard?: boolean
          position_cap_pct?: number
          updated_at?: string
          user_id?: string
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
      orders: {
        Row: {
          account_id: string
          average_fill_price: number | null
          broker_order_id: string | null
          created_at: string
          currency: string | null
          execution_source: string
          filled_quantity: number | null
          id: string
          limit_price: number | null
          lot_id: string | null
          notes: string | null
          oco_group: string | null
          order_type: string
          parent_order_id: string | null
          placed_at: string | null
          quantity: number | null
          side: string
          status: string
          status_as_of: string | null
          stop_price: number | null
          symbol: string
          time_in_force: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          average_fill_price?: number | null
          broker_order_id?: string | null
          created_at?: string
          currency?: string | null
          execution_source: string
          filled_quantity?: number | null
          id?: string
          limit_price?: number | null
          lot_id?: string | null
          notes?: string | null
          oco_group?: string | null
          order_type: string
          parent_order_id?: string | null
          placed_at?: string | null
          quantity?: number | null
          side: string
          status: string
          status_as_of?: string | null
          stop_price?: number | null
          symbol: string
          time_in_force?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          average_fill_price?: number | null
          broker_order_id?: string | null
          created_at?: string
          currency?: string | null
          execution_source?: string
          filled_quantity?: number | null
          id?: string
          limit_price?: number | null
          lot_id?: string | null
          notes?: string | null
          oco_group?: string | null
          order_type?: string
          parent_order_id?: string | null
          placed_at?: string | null
          quantity?: number | null
          side?: string
          status?: string
          status_as_of?: string | null
          stop_price?: number | null
          symbol?: string
          time_in_force?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "position_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_parent_order_id_fkey"
            columns: ["parent_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolio_snapshots: {
        Row: {
          account_id: string | null
          created_at: string
          gross: number
          id: string
          margin_used: number
          net: number
          scope: string
          snapshot_date: string | null
          user_id: string
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          gross?: number
          id?: string
          margin_used?: number
          net?: number
          scope?: string
          snapshot_date?: string | null
          user_id: string
        }
        Update: {
          account_id?: string | null
          created_at?: string
          gross?: number
          id?: string
          margin_used?: number
          net?: number
          scope?: string
          snapshot_date?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_snapshots_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      position_lots: {
        Row: {
          account_id: string
          acquired_at: string | null
          as_of: string | null
          broker_lot_id: string | null
          closed_at: string | null
          cost_per_share: number | null
          created_at: string
          id: string
          notes: string | null
          quantity: number | null
          source: string
          symbol: string
          thesis: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          acquired_at?: string | null
          as_of?: string | null
          broker_lot_id?: string | null
          closed_at?: string | null
          cost_per_share?: number | null
          created_at?: string
          id?: string
          notes?: string | null
          quantity?: number | null
          source: string
          symbol: string
          thesis?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          acquired_at?: string | null
          as_of?: string | null
          broker_lot_id?: string | null
          closed_at?: string | null
          cost_per_share?: number | null
          created_at?: string
          id?: string
          notes?: string | null
          quantity?: number | null
          source?: string
          symbol?: string
          thesis?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "position_lots_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      price_history: {
        Row: {
          close: number
          created_at: string
          date: string
          id: string
          security_id: string | null
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
          security_id?: string | null
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
          security_id?: string | null
          source?: string
          symbol?: string
          user_id?: string
          volume?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "price_history_security_id_fkey"
            columns: ["security_id"]
            isOneToOne: false
            referencedRelation: "securities"
            referencedColumns: ["id"]
          },
        ]
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
      securities: {
        Row: {
          asset_class: string
          canonical_symbol: string
          created_at: string
          cusip: string | null
          delisted_at: string | null
          figi: string | null
          id: string
          isin: string | null
          name: string | null
          sector: string | null
          sector_source: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          asset_class: string
          canonical_symbol: string
          created_at?: string
          cusip?: string | null
          delisted_at?: string | null
          figi?: string | null
          id?: string
          isin?: string | null
          name?: string | null
          sector?: string | null
          sector_source?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          asset_class?: string
          canonical_symbol?: string
          created_at?: string
          cusip?: string | null
          delisted_at?: string | null
          figi?: string | null
          id?: string
          isin?: string | null
          name?: string | null
          sector?: string | null
          sector_source?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      security_aliases: {
        Row: {
          alias: string
          alias_kind: string
          created_at: string
          id: string
          security_id: string
          source: string
          user_id: string
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          alias: string
          alias_kind: string
          created_at?: string
          id?: string
          security_id: string
          source: string
          user_id: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          alias?: string
          alias_kind?: string
          created_at?: string
          id?: string
          security_id?: string
          source?: string
          user_id?: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "security_aliases_security_id_fkey"
            columns: ["security_id"]
            isOneToOne: false
            referencedRelation: "securities"
            referencedColumns: ["id"]
          },
        ]
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
      strategies: {
        Row: {
          created_at: string
          id: string
          name: string
          parity_rule: string | null
          speculative_max_pct: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          parity_rule?: string | null
          speculative_max_pct?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          parity_rule?: string | null
          speculative_max_pct?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      strategy_symbols: {
        Row: {
          bucket: string
          created_at: string
          id: string
          strategy_id: string
          symbol: string
          user_id: string
        }
        Insert: {
          bucket: string
          created_at?: string
          id?: string
          strategy_id: string
          symbol: string
          user_id: string
        }
        Update: {
          bucket?: string
          created_at?: string
          id?: string
          strategy_id?: string
          symbol?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "strategy_symbols_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
        ]
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
      import_account_positions: {
        Args: {
          p_account_id: string
          p_as_of: string
          p_cash: number
          p_rows: Json
          p_source?: string
        }
        Returns: Json
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
