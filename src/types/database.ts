export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      ai_generation_requests: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          idempotency_key: string
          model: string
          plan_id: string | null
          prompt_version: string
          provider: string
          sanitized_error_code: string | null
          status: Database["public"]["Enums"]["ai_request_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key: string
          model: string
          plan_id?: string | null
          prompt_version: string
          provider: string
          sanitized_error_code?: string | null
          status?: Database["public"]["Enums"]["ai_request_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string
          model?: string
          plan_id?: string | null
          prompt_version?: string
          provider?: string
          sanitized_error_code?: string | null
          status?: Database["public"]["Enums"]["ai_request_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_generation_requests_plan_id_user_id_fkey"
            columns: ["plan_id", "user_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      allergens: {
        Row: {
          aliases: string[]
          english_label: string
          id: string
          slug: string
        }
        Insert: {
          aliases?: string[]
          english_label: string
          id?: string
          slug: string
        }
        Update: {
          aliases?: string[]
          english_label?: string
          id?: string
          slug?: string
        }
        Relationships: []
      }
      daily_checkins: {
        Row: {
          breakfast_completed: boolean
          created_at: string
          dinner_completed: boolean
          id: string
          local_date: string
          lunch_completed: boolean
          notes: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          breakfast_completed?: boolean
          created_at?: string
          dinner_completed?: boolean
          id?: string
          local_date: string
          lunch_completed?: boolean
          notes?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          breakfast_completed?: boolean
          created_at?: string
          dinner_completed?: boolean
          id?: string
          local_date?: string
          lunch_completed?: boolean
          notes?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      daily_meal_checkins: {
        Row: {
          created_at: string
          id: string
          local_date: string
          meal_type: Database["public"]["Enums"]["meal_type"]
          skip_reason: string | null
          status: Database["public"]["Enums"]["meal_checkin_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          local_date: string
          meal_type: Database["public"]["Enums"]["meal_type"]
          skip_reason?: string | null
          status?: Database["public"]["Enums"]["meal_checkin_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          local_date?: string
          meal_type?: Database["public"]["Enums"]["meal_type"]
          skip_reason?: string | null
          status?: Database["public"]["Enums"]["meal_checkin_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_meal_checkins_user_id_local_date_fkey"
            columns: ["user_id", "local_date"]
            isOneToOne: false
            referencedRelation: "daily_checkins"
            referencedColumns: ["user_id", "local_date"]
          },
        ]
      }
      daily_meal_items: {
        Row: {
          created_at: string
          food_id: string
          id: string
          meal_checkin_id: string
          sort_order: number
          user_id: string
        }
        Insert: {
          created_at?: string
          food_id: string
          id?: string
          meal_checkin_id: string
          sort_order: number
          user_id: string
        }
        Update: {
          created_at?: string
          food_id?: string
          id?: string
          meal_checkin_id?: string
          sort_order?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_meal_items_food_id_fkey"
            columns: ["food_id"]
            isOneToOne: false
            referencedRelation: "foods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_meal_items_meal_checkin_id_user_id_fkey"
            columns: ["meal_checkin_id", "user_id"]
            isOneToOne: false
            referencedRelation: "daily_meal_checkins"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      dietary_restriction_types: {
        Row: {
          aliases: string[]
          english_label: string
          id: string
          slug: string
        }
        Insert: {
          aliases?: string[]
          english_label: string
          id?: string
          slug: string
        }
        Update: {
          aliases?: string[]
          english_label?: string
          id?: string
          slug?: string
        }
        Relationships: []
      }
      external_food_lookup_requests: {
        Row: {
          id: string
          provider: Database["public"]["Enums"]["food_source_provider"]
          request_kind: string
          requested_at: string
          user_id: string
        }
        Insert: {
          id?: string
          provider: Database["public"]["Enums"]["food_source_provider"]
          request_kind: string
          requested_at?: string
          user_id: string
        }
        Update: {
          id?: string
          provider?: Database["public"]["Enums"]["food_source_provider"]
          request_kind?: string
          requested_at?: string
          user_id?: string
        }
        Relationships: []
      }
      food_allergens: {
        Row: {
          allergen_id: string
          food_id: string
        }
        Insert: {
          allergen_id: string
          food_id: string
        }
        Update: {
          allergen_id?: string
          food_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "food_allergens_allergen_id_fkey"
            columns: ["allergen_id"]
            isOneToOne: false
            referencedRelation: "allergens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "food_allergens_food_id_fkey"
            columns: ["food_id"]
            isOneToOne: false
            referencedRelation: "foods"
            referencedColumns: ["id"]
          },
        ]
      }
      food_categories: {
        Row: {
          english_label: string
          id: string
          slug: string
        }
        Insert: {
          english_label: string
          id?: string
          slug: string
        }
        Update: {
          english_label?: string
          id?: string
          slug?: string
        }
        Relationships: []
      }
      food_category_links: {
        Row: {
          category_id: string
          food_id: string
        }
        Insert: {
          category_id: string
          food_id: string
        }
        Update: {
          category_id?: string
          food_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "food_category_links_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "food_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "food_category_links_food_id_fkey"
            columns: ["food_id"]
            isOneToOne: false
            referencedRelation: "foods"
            referencedColumns: ["id"]
          },
        ]
      }
      food_dietary_restrictions: {
        Row: {
          food_id: string
          restriction_id: string
        }
        Insert: {
          food_id: string
          restriction_id: string
        }
        Update: {
          food_id?: string
          restriction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "food_dietary_restrictions_food_id_fkey"
            columns: ["food_id"]
            isOneToOne: false
            referencedRelation: "foods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "food_dietary_restrictions_restriction_id_fkey"
            columns: ["restriction_id"]
            isOneToOne: false
            referencedRelation: "dietary_restriction_types"
            referencedColumns: ["id"]
          },
        ]
      }
      food_label_images: {
        Row: {
          byte_size: number
          created_at: string
          id: string
          image_kind: Database["public"]["Enums"]["food_label_image_kind"]
          mime_type: string
          object_path: string
          pixel_height: number
          pixel_width: number
          sha256: string
          submission_id: string
          user_id: string
        }
        Insert: {
          byte_size: number
          created_at?: string
          id?: string
          image_kind: Database["public"]["Enums"]["food_label_image_kind"]
          mime_type: string
          object_path: string
          pixel_height: number
          pixel_width: number
          sha256: string
          submission_id: string
          user_id: string
        }
        Update: {
          byte_size?: number
          created_at?: string
          id?: string
          image_kind?: Database["public"]["Enums"]["food_label_image_kind"]
          mime_type?: string
          object_path?: string
          pixel_height?: number
          pixel_width?: number
          sha256?: string
          submission_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "food_label_images_submission_id_user_id_fkey"
            columns: ["submission_id", "user_id"]
            isOneToOne: false
            referencedRelation: "food_label_submissions"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      food_label_submissions: {
        Row: {
          brand_name: string
          created_at: string
          gtin: string | null
          id: string
          label_data: Json
          package_description: string | null
          private_food_id: string | null
          product_name: string
          published_food_id: string | null
          review_note: string | null
          reviewed_at: string | null
          status: Database["public"]["Enums"]["food_label_submission_status"]
          submitted_at: string | null
          updated_at: string
          user_id: string
          variant_name: string | null
        }
        Insert: {
          brand_name: string
          created_at?: string
          gtin?: string | null
          id?: string
          label_data: Json
          package_description?: string | null
          private_food_id?: string | null
          product_name: string
          published_food_id?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          status?: Database["public"]["Enums"]["food_label_submission_status"]
          submitted_at?: string | null
          updated_at?: string
          user_id: string
          variant_name?: string | null
        }
        Update: {
          brand_name?: string
          created_at?: string
          gtin?: string | null
          id?: string
          label_data?: Json
          package_description?: string | null
          private_food_id?: string | null
          product_name?: string
          published_food_id?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          status?: Database["public"]["Enums"]["food_label_submission_status"]
          submitted_at?: string | null
          updated_at?: string
          user_id?: string
          variant_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "food_label_submissions_private_food_id_fkey"
            columns: ["private_food_id"]
            isOneToOne: false
            referencedRelation: "foods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "food_label_submissions_published_food_id_fkey"
            columns: ["published_food_id"]
            isOneToOne: false
            referencedRelation: "foods"
            referencedColumns: ["id"]
          },
        ]
      }
      food_nutrient_amounts: {
        Row: {
          amount: number
          created_at: string
          daily_value_percent: number | null
          display_name: string
          display_order: number
          nutrient_code: string
          nutrition_id: string
          unit: string
        }
        Insert: {
          amount: number
          created_at?: string
          daily_value_percent?: number | null
          display_name: string
          display_order?: number
          nutrient_code: string
          nutrition_id: string
          unit: string
        }
        Update: {
          amount?: number
          created_at?: string
          daily_value_percent?: number | null
          display_name?: string
          display_order?: number
          nutrient_code?: string
          nutrition_id?: string
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "food_nutrient_amounts_nutrition_id_fkey"
            columns: ["nutrition_id"]
            isOneToOne: false
            referencedRelation: "food_nutrition"
            referencedColumns: ["id"]
          },
        ]
      }
      food_nutrition: {
        Row: {
          added_sugars_g: number | null
          calcium_mg: number | null
          calories: number | null
          carbohydrate_g: number | null
          cholesterol_mg: number | null
          created_at: string
          energy_kj: number | null
          fat_g: number | null
          fiber_g: number | null
          food_id: string
          id: string
          iron_mg: number | null
          measurement_basis: Database["public"]["Enums"]["measurement_basis"]
          potassium_mg: number | null
          protein_g: number | null
          reference_quantity: number
          reference_unit: Database["public"]["Enums"]["nutrition_reference_unit"]
          saturated_fat_g: number | null
          serving_description: string | null
          serving_weight_grams: number | null
          sodium_mg: number | null
          source_id: string | null
          source_name: string | null
          source_reference: string | null
          source_version: string | null
          total_sugars_g: number | null
          trans_fat_g: number | null
          updated_at: string
          verification_status: Database["public"]["Enums"]["verification_status"]
          verified_at: string | null
          vitamin_d_mcg: number | null
        }
        Insert: {
          added_sugars_g?: number | null
          calcium_mg?: number | null
          calories?: number | null
          carbohydrate_g?: number | null
          cholesterol_mg?: number | null
          created_at?: string
          energy_kj?: number | null
          fat_g?: number | null
          fiber_g?: number | null
          food_id: string
          id?: string
          iron_mg?: number | null
          measurement_basis: Database["public"]["Enums"]["measurement_basis"]
          potassium_mg?: number | null
          protein_g?: number | null
          reference_quantity: number
          reference_unit: Database["public"]["Enums"]["nutrition_reference_unit"]
          saturated_fat_g?: number | null
          serving_description?: string | null
          serving_weight_grams?: number | null
          sodium_mg?: number | null
          source_id?: string | null
          source_name?: string | null
          source_reference?: string | null
          source_version?: string | null
          total_sugars_g?: number | null
          trans_fat_g?: number | null
          updated_at?: string
          verification_status: Database["public"]["Enums"]["verification_status"]
          verified_at?: string | null
          vitamin_d_mcg?: number | null
        }
        Update: {
          added_sugars_g?: number | null
          calcium_mg?: number | null
          calories?: number | null
          carbohydrate_g?: number | null
          cholesterol_mg?: number | null
          created_at?: string
          energy_kj?: number | null
          fat_g?: number | null
          fiber_g?: number | null
          food_id?: string
          id?: string
          iron_mg?: number | null
          measurement_basis?: Database["public"]["Enums"]["measurement_basis"]
          potassium_mg?: number | null
          protein_g?: number | null
          reference_quantity?: number
          reference_unit?: Database["public"]["Enums"]["nutrition_reference_unit"]
          saturated_fat_g?: number | null
          serving_description?: string | null
          serving_weight_grams?: number | null
          sodium_mg?: number | null
          source_id?: string | null
          source_name?: string | null
          source_reference?: string | null
          source_version?: string | null
          total_sugars_g?: number | null
          trans_fat_g?: number | null
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["verification_status"]
          verified_at?: string | null
          vitamin_d_mcg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "food_nutrition_food_id_fkey"
            columns: ["food_id"]
            isOneToOne: false
            referencedRelation: "foods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "food_nutrition_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "food_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      food_products: {
        Row: {
          brand_name: string
          country_codes: string[]
          created_at: string
          food_id: string
          gtin: string | null
          manufacturer_name: string | null
          package_description: string | null
          parent_food_id: string | null
          product_name: string
          updated_at: string
          variant_name: string | null
        }
        Insert: {
          brand_name: string
          country_codes?: string[]
          created_at?: string
          food_id: string
          gtin?: string | null
          manufacturer_name?: string | null
          package_description?: string | null
          parent_food_id?: string | null
          product_name: string
          updated_at?: string
          variant_name?: string | null
        }
        Update: {
          brand_name?: string
          country_codes?: string[]
          created_at?: string
          food_id?: string
          gtin?: string | null
          manufacturer_name?: string | null
          package_description?: string | null
          parent_food_id?: string | null
          product_name?: string
          updated_at?: string
          variant_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "food_products_food_id_fkey"
            columns: ["food_id"]
            isOneToOne: true
            referencedRelation: "foods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "food_products_parent_food_id_fkey"
            columns: ["parent_food_id"]
            isOneToOne: false
            referencedRelation: "foods"
            referencedColumns: ["id"]
          },
        ]
      }
      food_safety_metadata: {
        Row: {
          allergen_data_status: Database["public"]["Enums"]["food_safety_data_status"]
          allergen_statement: string | null
          created_at: string
          food_id: string
          ingredients_text: string | null
          restriction_data_status: Database["public"]["Enums"]["food_safety_data_status"]
          source_id: string | null
          updated_at: string
        }
        Insert: {
          allergen_data_status?: Database["public"]["Enums"]["food_safety_data_status"]
          allergen_statement?: string | null
          created_at?: string
          food_id: string
          ingredients_text?: string | null
          restriction_data_status?: Database["public"]["Enums"]["food_safety_data_status"]
          source_id?: string | null
          updated_at?: string
        }
        Update: {
          allergen_data_status?: Database["public"]["Enums"]["food_safety_data_status"]
          allergen_statement?: string | null
          created_at?: string
          food_id?: string
          ingredients_text?: string | null
          restriction_data_status?: Database["public"]["Enums"]["food_safety_data_status"]
          source_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "food_safety_metadata_food_id_fkey"
            columns: ["food_id"]
            isOneToOne: true
            referencedRelation: "foods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "food_safety_metadata_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "food_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      food_sources: {
        Row: {
          attribution_text: string | null
          created_at: string
          external_id: string
          food_id: string
          id: string
          license_code: string | null
          payload_sha256: string | null
          provider: Database["public"]["Enums"]["food_source_provider"]
          retrieved_at: string
          source_modified_at: string | null
          source_url: string | null
          source_version: string | null
          updated_at: string
        }
        Insert: {
          attribution_text?: string | null
          created_at?: string
          external_id: string
          food_id: string
          id?: string
          license_code?: string | null
          payload_sha256?: string | null
          provider: Database["public"]["Enums"]["food_source_provider"]
          retrieved_at?: string
          source_modified_at?: string | null
          source_url?: string | null
          source_version?: string | null
          updated_at?: string
        }
        Update: {
          attribution_text?: string | null
          created_at?: string
          external_id?: string
          food_id?: string
          id?: string
          license_code?: string | null
          payload_sha256?: string | null
          provider?: Database["public"]["Enums"]["food_source_provider"]
          retrieved_at?: string
          source_modified_at?: string | null
          source_url?: string | null
          source_version?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "food_sources_food_id_fkey"
            columns: ["food_id"]
            isOneToOne: false
            referencedRelation: "foods"
            referencedColumns: ["id"]
          },
        ]
      }
      foods: {
        Row: {
          catalog_status: Database["public"]["Enums"]["food_catalog_status"]
          created_at: string
          english_name: string
          food_kind: Database["public"]["Enums"]["food_kind"]
          icon_ref: string | null
          id: string
          owner_user_id: string | null
          ownership_type: Database["public"]["Enums"]["food_ownership_type"]
          slug: string
          source: string
          updated_at: string
          verification_status: Database["public"]["Enums"]["verification_status"]
        }
        Insert: {
          catalog_status?: Database["public"]["Enums"]["food_catalog_status"]
          created_at?: string
          english_name: string
          food_kind?: Database["public"]["Enums"]["food_kind"]
          icon_ref?: string | null
          id?: string
          owner_user_id?: string | null
          ownership_type: Database["public"]["Enums"]["food_ownership_type"]
          slug: string
          source: string
          updated_at?: string
          verification_status: Database["public"]["Enums"]["verification_status"]
        }
        Update: {
          catalog_status?: Database["public"]["Enums"]["food_catalog_status"]
          created_at?: string
          english_name?: string
          food_kind?: Database["public"]["Enums"]["food_kind"]
          icon_ref?: string | null
          id?: string
          owner_user_id?: string | null
          ownership_type?: Database["public"]["Enums"]["food_ownership_type"]
          slug?: string
          source?: string
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["verification_status"]
        }
        Relationships: []
      }
      goals: {
        Row: {
          created_at: string
          goal_type: Database["public"]["Enums"]["goal_type"]
          id: string
          plan_start_date: string
          status: Database["public"]["Enums"]["goal_status"]
          target_date: string
          target_weight_kg: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          goal_type: Database["public"]["Enums"]["goal_type"]
          id?: string
          plan_start_date: string
          status?: Database["public"]["Enums"]["goal_status"]
          target_date: string
          target_weight_kg: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          goal_type?: Database["public"]["Enums"]["goal_type"]
          id?: string
          plan_start_date?: string
          status?: Database["public"]["Enums"]["goal_status"]
          target_date?: string
          target_weight_kg?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      legal_acceptances: {
        Row: {
          accepted_at: string
          document_type: Database["public"]["Enums"]["legal_document_type"]
          document_version: string
          id: string
          user_id: string
        }
        Insert: {
          accepted_at?: string
          document_type: Database["public"]["Enums"]["legal_document_type"]
          document_version: string
          id?: string
          user_id: string
        }
        Update: {
          accepted_at?: string
          document_type?: Database["public"]["Enums"]["legal_document_type"]
          document_version?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      meal_preferences: {
        Row: {
          created_at: string
          food_id: string
          id: string
          meal_type: Database["public"]["Enums"]["meal_type"]
          sort_order: number
          user_id: string
        }
        Insert: {
          created_at?: string
          food_id: string
          id?: string
          meal_type: Database["public"]["Enums"]["meal_type"]
          sort_order: number
          user_id: string
        }
        Update: {
          created_at?: string
          food_id?: string
          id?: string
          meal_type?: Database["public"]["Enums"]["meal_type"]
          sort_order?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meal_preferences_food_id_fkey"
            columns: ["food_id"]
            isOneToOne: false
            referencedRelation: "foods"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_drafts: {
        Row: {
          current_step: number
          updated_at: string
          user_id: string
          validated_data: Json
        }
        Insert: {
          current_step?: number
          updated_at?: string
          user_id: string
          validated_data?: Json
        }
        Update: {
          current_step?: number
          updated_at?: string
          user_id?: string
          validated_data?: Json
        }
        Relationships: []
      }
      onboarding_warnings: {
        Row: {
          acknowledged_at: string
          context_type: Database["public"]["Enums"]["warning_context_type"]
          context_version: string
          id: string
          meal_type: Database["public"]["Enums"]["meal_type"]
          user_id: string
          warning_code: string
        }
        Insert: {
          acknowledged_at?: string
          context_type: Database["public"]["Enums"]["warning_context_type"]
          context_version: string
          id?: string
          meal_type: Database["public"]["Enums"]["meal_type"]
          user_id: string
          warning_code: string
        }
        Update: {
          acknowledged_at?: string
          context_type?: Database["public"]["Enums"]["warning_context_type"]
          context_version?: string
          id?: string
          meal_type?: Database["public"]["Enums"]["meal_type"]
          user_id?: string
          warning_code?: string
        }
        Relationships: []
      }
      plan_days: {
        Row: {
          day_index: number
          id: string
          plan_id: string
          title: string | null
        }
        Insert: {
          day_index: number
          id?: string
          plan_id: string
          title?: string | null
        }
        Update: {
          day_index?: number
          id?: string
          plan_id?: string
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plan_days_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_items: {
        Row: {
          food_id: string
          id: string
          measurement_basis: Database["public"]["Enums"]["measurement_basis"]
          plan_meal_id: string
          preparation_note: string | null
          quantity: number
          sort_order: number
          substitution_group: string | null
          unit: Database["public"]["Enums"]["portion_unit"]
          verification_status: Database["public"]["Enums"]["verification_status"]
        }
        Insert: {
          food_id: string
          id?: string
          measurement_basis: Database["public"]["Enums"]["measurement_basis"]
          plan_meal_id: string
          preparation_note?: string | null
          quantity: number
          sort_order: number
          substitution_group?: string | null
          unit: Database["public"]["Enums"]["portion_unit"]
          verification_status: Database["public"]["Enums"]["verification_status"]
        }
        Update: {
          food_id?: string
          id?: string
          measurement_basis?: Database["public"]["Enums"]["measurement_basis"]
          plan_meal_id?: string
          preparation_note?: string | null
          quantity?: number
          sort_order?: number
          substitution_group?: string | null
          unit?: Database["public"]["Enums"]["portion_unit"]
          verification_status?: Database["public"]["Enums"]["verification_status"]
        }
        Relationships: [
          {
            foreignKeyName: "plan_items_food_id_fkey"
            columns: ["food_id"]
            isOneToOne: false
            referencedRelation: "foods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_items_food_id_measurement_basis_fkey"
            columns: ["food_id", "measurement_basis"]
            isOneToOne: false
            referencedRelation: "food_nutrition"
            referencedColumns: ["food_id", "measurement_basis"]
          },
          {
            foreignKeyName: "plan_items_plan_meal_id_fkey"
            columns: ["plan_meal_id"]
            isOneToOne: false
            referencedRelation: "plan_meals"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_meals: {
        Row: {
          id: string
          meal_type: Database["public"]["Enums"]["meal_type"]
          plan_day_id: string
          sort_order: number
        }
        Insert: {
          id?: string
          meal_type: Database["public"]["Enums"]["meal_type"]
          plan_day_id: string
          sort_order: number
        }
        Update: {
          id?: string
          meal_type?: Database["public"]["Enums"]["meal_type"]
          plan_day_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "plan_meals_plan_day_id_fkey"
            columns: ["plan_day_id"]
            isOneToOne: false
            referencedRelation: "plan_days"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          accepted_at: string | null
          created_at: string
          goal_id: string
          id: string
          input_snapshot: Json
          model: string
          prompt_version: string
          provider: string
          status: Database["public"]["Enums"]["plan_status"]
          updated_at: string
          user_id: string
          validated_output_snapshot: Json
          version: number
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          goal_id: string
          id?: string
          input_snapshot: Json
          model: string
          prompt_version: string
          provider: string
          status?: Database["public"]["Enums"]["plan_status"]
          updated_at?: string
          user_id: string
          validated_output_snapshot: Json
          version: number
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          goal_id?: string
          id?: string
          input_snapshot?: Json
          model?: string
          prompt_version?: string
          provider?: string
          status?: Database["public"]["Enums"]["plan_status"]
          updated_at?: string
          user_id?: string
          validated_output_snapshot?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "plans_goal_id_user_id_fkey"
            columns: ["goal_id", "user_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      profiles: {
        Row: {
          activity_level: Database["public"]["Enums"]["activity_level"] | null
          age: number | null
          allergies: string[]
          created_at: string
          date_of_birth: string | null
          dietary_restrictions: string[]
          disliked_foods: string[]
          full_name: string
          gender: Database["public"]["Enums"]["profile_gender"] | null
          height_cm: number | null
          notes: string | null
          onboarding_completed_at: string | null
          onboarding_status: Database["public"]["Enums"]["onboarding_status"]
          preferred_weight_unit: Database["public"]["Enums"]["weight_unit"]
          product_tour_completed_at: string | null
          product_tour_completed_version: number
          safety_context: string | null
          time_zone: string
          training_days_per_week: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          activity_level?: Database["public"]["Enums"]["activity_level"] | null
          age?: number | null
          allergies?: string[]
          created_at?: string
          date_of_birth?: string | null
          dietary_restrictions?: string[]
          disliked_foods?: string[]
          full_name: string
          gender?: Database["public"]["Enums"]["profile_gender"] | null
          height_cm?: number | null
          notes?: string | null
          onboarding_completed_at?: string | null
          onboarding_status?: Database["public"]["Enums"]["onboarding_status"]
          preferred_weight_unit?: Database["public"]["Enums"]["weight_unit"]
          product_tour_completed_at?: string | null
          product_tour_completed_version?: number
          safety_context?: string | null
          time_zone?: string
          training_days_per_week?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          activity_level?: Database["public"]["Enums"]["activity_level"] | null
          age?: number | null
          allergies?: string[]
          created_at?: string
          date_of_birth?: string | null
          dietary_restrictions?: string[]
          disliked_foods?: string[]
          full_name?: string
          gender?: Database["public"]["Enums"]["profile_gender"] | null
          height_cm?: number | null
          notes?: string | null
          onboarding_completed_at?: string | null
          onboarding_status?: Database["public"]["Enums"]["onboarding_status"]
          preferred_weight_unit?: Database["public"]["Enums"]["weight_unit"]
          product_tour_completed_at?: string | null
          product_tour_completed_version?: number
          safety_context?: string | null
          time_zone?: string
          training_days_per_week?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      weight_entries: {
        Row: {
          created_at: string
          id: string
          is_onboarding_baseline: boolean
          local_date: string
          source_display_unit: Database["public"]["Enums"]["weight_unit"]
          updated_at: string
          user_id: string
          weight_kg: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_onboarding_baseline?: boolean
          local_date: string
          source_display_unit: Database["public"]["Enums"]["weight_unit"]
          updated_at?: string
          user_id: string
          weight_kg: number
        }
        Update: {
          created_at?: string
          id?: string
          is_onboarding_baseline?: boolean
          local_date?: string
          source_display_unit?: Database["public"]["Enums"]["weight_unit"]
          updated_at?: string
          user_id?: string
          weight_kg?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      abandon_food_label_upload: {
        Args: { target_reservation_token: string; target_user_id: string }
        Returns: boolean
      }
      accept_plan: { Args: { target_plan_id: string }; Returns: string }
      add_daily_meal_item: {
        Args: {
          checkin_date: string
          target_food_id: string
          target_meal_type: Database["public"]["Enums"]["meal_type"]
        }
        Returns: {
          created_at: string
          food_id: string
          id: string
          meal_checkin_id: string
          sort_order: number
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "daily_meal_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      application_health: {
        Args: { expected_migration: string }
        Returns: Json
      }
      begin_food_label_upload: {
        Args: {
          target_image_kind: Database["public"]["Enums"]["food_label_image_kind"]
          target_object_path: string
          target_preflight_token: string
          target_sha256: string
          target_submission_id: string
          target_user_id: string
        }
        Returns: {
          allowed: boolean
          existing_image_id: string
          existing_object_path: string
          object_path: string
          rate_limited: boolean
          reservation_token: string
        }[]
      }
      cache_external_food: {
        Args: {
          normalized_food: Json
          normalized_nutrition: Json
          source_external_id: string
          source_metadata: Json
          source_provider: Database["public"]["Enums"]["food_source_provider"]
          source_snapshot: Json
        }
        Returns: string
      }
      complete_food_label_object_cleanup: {
        Args: { target_object_path: string; target_user_id: string }
        Returns: boolean
      }
      complete_onboarding: {
        Args: {
          acknowledged_warnings?: Json
          current_weight_kg: number
          plan_start_date: string
          preferences: Json
          profile_activity_level: Database["public"]["Enums"]["activity_level"]
          profile_age: number
          profile_allergies: string[]
          profile_dietary_restrictions: string[]
          profile_disliked_foods: string[]
          profile_gender_value: Database["public"]["Enums"]["profile_gender"]
          profile_height_cm: number
          profile_notes: string
          profile_safety_context: string
          profile_time_zone: string
          profile_training_days: number
          profile_weight_unit: Database["public"]["Enums"]["weight_unit"]
          selected_goal_type: Database["public"]["Enums"]["goal_type"]
          target_date: string
          target_weight_kg: number
        }
        Returns: string
      }
      complete_onboarding_from_slugs: {
        Args: {
          acknowledged_warnings?: Json
          current_weight_kg: number
          plan_start_date: string
          preference_slugs: Json
          profile_activity_level: Database["public"]["Enums"]["activity_level"]
          profile_allergies: string[]
          profile_dietary_restrictions: string[]
          profile_disliked_foods: string[]
          profile_height_cm: number
          profile_notes: string
          profile_safety_context: string
          profile_time_zone: string
          profile_training_days: number
          profile_weight_unit: Database["public"]["Enums"]["weight_unit"]
          selected_goal_type: Database["public"]["Enums"]["goal_type"]
          target_date: string
          target_weight_kg: number
        }
        Returns: string
      }
      create_confirmed_label_food: {
        Args: { label_data: Json; label_submission_id?: string }
        Returns: string
      }
      delete_daily_meal_item: {
        Args: { target_item_id: string }
        Returns: string
      }
      delete_weight_entry: {
        Args: { target_entry_id: string }
        Returns: string
      }
      finalize_food_label_upload: {
        Args: {
          target_byte_size: number
          target_mime_type: string
          target_pixel_height: number
          target_pixel_width: number
          target_reservation_token: string
          target_sha256: string
          target_submission_id: string
          target_user_id: string
        }
        Returns: {
          accepted: boolean
          byte_size: number
          image_id: string
          image_kind: Database["public"]["Enums"]["food_label_image_kind"]
          pixel_height: number
          pixel_width: number
          reservation_conflict: boolean
        }[]
      }
      mark_food_label_upload_stored: {
        Args: { target_reservation_token: string; target_user_id: string }
        Returns: boolean
      }
      pending_food_label_object_cleanup: {
        Args: { result_limit?: number; target_user_id: string }
        Returns: {
          object_path: string
        }[]
      }
      plan_eligible_food_ids: {
        Args: { candidate_food_ids: string[] }
        Returns: {
          food_id: string
        }[]
      }
      preflight_food_label_upload: {
        Args: {
          target_image_kind: Database["public"]["Enums"]["food_label_image_kind"]
          target_submission_id: string
          target_user_id: string
        }
        Returns: {
          allowed: boolean
          preflight_token: string
          rate_limited: boolean
        }[]
      }
      record_external_food_lookup: {
        Args: {
          lookup_kind: string
          lookup_provider: Database["public"]["Enums"]["food_source_provider"]
          target_user_id: string
        }
        Returns: Json
      }
      repair_verified_profile: { Args: never; Returns: Json }
      reserve_plan_generation: {
        Args: {
          request_idempotency_key: string
          request_model: string
          request_prompt_version: string
          request_provider: string
          target_user_id: string
        }
        Returns: {
          plan_id: string
          request_id: string
          request_status: Database["public"]["Enums"]["ai_request_status"]
          result_state: string
        }[]
      }
      save_plan_version: {
        Args: {
          generation_request_id: string
          plan_input_snapshot: Json
          plan_model: string
          plan_output: Json
          plan_prompt_version: string
          plan_provider: string
          target_goal_id: string
          target_user_id: string
        }
        Returns: string
      }
      save_weight_entry: {
        Args: {
          entry_date: string
          entry_source_display_unit: Database["public"]["Enums"]["weight_unit"]
          entry_weight_kg: number
        }
        Returns: {
          created_at: string
          id: string
          is_onboarding_baseline: boolean
          local_date: string
          source_display_unit: Database["public"]["Enums"]["weight_unit"]
          updated_at: string
          user_id: string
          weight_kg: number
        }
        SetofOptions: {
          from: "*"
          to: "weight_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      search_food_catalog: {
        Args: {
          result_limit?: number
          result_offset?: number
          search_query?: string
        }
        Returns: {
          brand_name: string
          catalog_status: Database["public"]["Enums"]["food_catalog_status"]
          categories: string[]
          english_name: string
          food_kind: Database["public"]["Enums"]["food_kind"]
          gtin: string
          icon_ref: string
          id: string
          nutrition: Json
          ownership_type: Database["public"]["Enums"]["food_ownership_type"]
          package_description: string
          plan_eligible: boolean
          product_name: string
          slug: string
          source: Json
          total_count: number
          variant_name: string
          verification_status: Database["public"]["Enums"]["verification_status"]
        }[]
      }
      set_daily_checkin_note: {
        Args: { checkin_date: string; desired_note: string }
        Returns: {
          breakfast_completed: boolean
          created_at: string
          dinner_completed: boolean
          id: string
          local_date: string
          lunch_completed: boolean
          notes: string | null
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "daily_checkins"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_daily_meal_checkin: {
        Args: {
          checkin_date: string
          desired_skip_reason?: string
          desired_status: Database["public"]["Enums"]["meal_checkin_status"]
          target_meal_type: Database["public"]["Enums"]["meal_type"]
        }
        Returns: {
          created_at: string
          id: string
          local_date: string
          meal_type: Database["public"]["Enums"]["meal_type"]
          skip_reason: string | null
          status: Database["public"]["Enums"]["meal_checkin_status"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "daily_meal_checkins"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submit_food_label: {
        Args: { target_submission_id: string }
        Returns: {
          brand_name: string
          created_at: string
          gtin: string | null
          id: string
          label_data: Json
          package_description: string | null
          private_food_id: string | null
          product_name: string
          published_food_id: string | null
          review_note: string | null
          reviewed_at: string | null
          status: Database["public"]["Enums"]["food_label_submission_status"]
          submitted_at: string | null
          updated_at: string
          user_id: string
          variant_name: string | null
        }
        SetofOptions: {
          from: "*"
          to: "food_label_submissions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_weight_entry: {
        Args: {
          entry_source_display_unit: Database["public"]["Enums"]["weight_unit"]
          entry_weight_kg: number
          target_entry_id: string
        }
        Returns: {
          created_at: string
          id: string
          is_onboarding_baseline: boolean
          local_date: string
          source_display_unit: Database["public"]["Enums"]["weight_unit"]
          updated_at: string
          user_id: string
          weight_kg: number
        }
        SetofOptions: {
          from: "*"
          to: "weight_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      upsert_daily_checkin: {
        Args: {
          checkin_date: string
          checkin_notes?: string
          desired_breakfast_completed: boolean
          desired_dinner_completed: boolean
          desired_lunch_completed: boolean
        }
        Returns: {
          breakfast_completed: boolean
          created_at: string
          dinner_completed: boolean
          id: string
          local_date: string
          lunch_completed: boolean
          notes: string | null
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "daily_checkins"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      activity_level:
        | "sedentary"
        | "lightly_active"
        | "moderately_active"
        | "very_active"
        | "extremely_active"
      ai_request_status: "pending" | "processing" | "succeeded" | "failed"
      food_catalog_status: "active" | "pending_review" | "rejected" | "retired"
      food_kind: "generic" | "branded_product"
      food_label_image_kind: "front" | "nutrition" | "ingredients" | "barcode"
      food_label_submission_status:
        | "draft"
        | "submitted"
        | "needs_changes"
        | "approved"
        | "rejected"
        | "matched"
      food_ownership_type: "catalog" | "private"
      food_safety_data_status:
        | "unknown"
        | "source_reported"
        | "user_confirmed"
        | "reviewed"
      food_source_provider:
        | "usda_fdc"
        | "open_food_facts"
        | "user_label"
        | "manual_review"
      goal_status: "draft" | "active" | "completed" | "cancelled" | "archived"
      goal_type:
        | "fat_loss"
        | "muscle_gain"
        | "maintenance"
        | "body_recomposition"
      legal_document_type: "terms" | "privacy"
      meal_checkin_status: "not_marked" | "completed" | "skipped"
      meal_type:
        | "breakfast"
        | "morning_snack"
        | "lunch"
        | "afternoon_snack"
        | "dinner"
        | "evening_snack"
      measurement_basis: "raw" | "dry" | "cooked" | "as_sold" | "label_serving"
      nutrition_reference_unit: "g" | "serving"
      onboarding_status: "not_started" | "in_progress" | "completed"
      plan_status: "generated" | "accepted" | "superseded" | "archived"
      portion_unit: "g" | "ml" | "serving" | "piece"
      profile_gender:
        | "male"
        | "female"
        | "another_identity"
        | "prefer_not_to_say"
      verification_status:
        | "verified"
        | "user_label"
        | "source_reported"
        | "pending_verification"
        | "unavailable"
      warning_context_type: "onboarding" | "plan"
      weight_unit: "kg" | "lb"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      activity_level: [
        "sedentary",
        "lightly_active",
        "moderately_active",
        "very_active",
        "extremely_active",
      ],
      ai_request_status: ["pending", "processing", "succeeded", "failed"],
      food_catalog_status: ["active", "pending_review", "rejected", "retired"],
      food_kind: ["generic", "branded_product"],
      food_label_image_kind: ["front", "nutrition", "ingredients", "barcode"],
      food_label_submission_status: [
        "draft",
        "submitted",
        "needs_changes",
        "approved",
        "rejected",
        "matched",
      ],
      food_ownership_type: ["catalog", "private"],
      food_safety_data_status: [
        "unknown",
        "source_reported",
        "user_confirmed",
        "reviewed",
      ],
      food_source_provider: [
        "usda_fdc",
        "open_food_facts",
        "user_label",
        "manual_review",
      ],
      goal_status: ["draft", "active", "completed", "cancelled", "archived"],
      goal_type: [
        "fat_loss",
        "muscle_gain",
        "maintenance",
        "body_recomposition",
      ],
      legal_document_type: ["terms", "privacy"],
      meal_checkin_status: ["not_marked", "completed", "skipped"],
      meal_type: [
        "breakfast",
        "morning_snack",
        "lunch",
        "afternoon_snack",
        "dinner",
        "evening_snack",
      ],
      measurement_basis: ["raw", "dry", "cooked", "as_sold", "label_serving"],
      nutrition_reference_unit: ["g", "serving"],
      onboarding_status: ["not_started", "in_progress", "completed"],
      plan_status: ["generated", "accepted", "superseded", "archived"],
      portion_unit: ["g", "ml", "serving", "piece"],
      profile_gender: [
        "male",
        "female",
        "another_identity",
        "prefer_not_to_say",
      ],
      verification_status: [
        "verified",
        "user_label",
        "source_reported",
        "pending_verification",
        "unavailable",
      ],
      warning_context_type: ["onboarding", "plan"],
      weight_unit: ["kg", "lb"],
    },
  },
} as const
