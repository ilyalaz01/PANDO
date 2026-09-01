export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  api: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_current_custom_activity_v1: {
        Args: {
          p_activity_key: string
          p_activity_type: string
          p_expected_overlay_version: string
          p_idempotency_key: string
          p_readiness_goal_key: string
          p_target_competency_ref: string
          p_title: string
        }
        Returns: Json
      }
      add_learning_track_activity_v1: {
        Args: {
          p_activity_key: string
          p_energy?: string
          p_estimated_minutes: number
          p_expected_learning_track_version: string
          p_idempotency_key: string
          p_learning_track_key: string
        }
        Returns: Json
      }
      apply_growth_plan_capacity_v1: {
        Args: {
          p_expected_growth_plan_version: string
          p_idempotency_key: string
          p_preview_digest: string
          p_proposed_weekly_capacity_minutes: number
          p_reason: string
        }
        Returns: Json
      }
      apply_growth_plan_initialization_v1: {
        Args: {
          p_default_session_minutes: number
          p_expected_readiness_goal_version: string
          p_idempotency_key: string
          p_preview_digest: string
          p_readiness_goal_key: string
          p_reason: string
          p_track_priority: number
          p_weekly_capacity_minutes: number
        }
        Returns: Json
      }
      apply_learning_track_creation_v1: {
        Args: {
          p_default_session_minutes: number
          p_expected_growth_plan_version: string
          p_expected_readiness_goal_version: string
          p_preview_digest: string
          p_priority: number
          p_readiness_goal_key: string
          p_reason: string
          p_request_id: string
          p_title: string
        }
        Returns: Json
      }
      apply_growth_plan_lifecycle_v1: {
        Args: {
          p_expected_growth_plan_version: string
          p_idempotency_key: string
          p_operation: string
          p_preview_digest: string
          p_reason: string
        }
        Returns: Json
      }
      apply_learning_track_activity_admission_v1: {
        Args: {
          p_activity_key: string
          p_energy: string
          p_estimated_minutes: number
          p_expected_growth_plan_version: string
          p_expected_learning_track_version: string
          p_preview_digest: string
          p_reason: string
          p_request_id: string
        }
        Returns: Json
      }
      apply_learning_track_lifecycle_v1: {
        Args: {
          p_expected_growth_plan_version: string
          p_expected_learning_track_version: string
          p_idempotency_key: string
          p_operation: string
          p_preview_digest: string
          p_reason: string
          p_track_key: string
        }
        Returns: Json
      }
      apply_learning_track_priority_minimum_v1: {
        Args: {
          p_expected_growth_plan_version: string
          p_expected_learning_track_version: string
          p_idempotency_key: string
          p_preview_digest: string
          p_priority: number
          p_protected_minimum_minutes: number
          p_reason: string
          p_track_key: string
        }
        Returns: Json
      }
      bootstrap_personal_workspace: {
        Args: { p_idempotency_key: string; p_workspace_name?: string }
        Returns: Json
      }
      claim_mastery_evidence_projection_v1: {
        Args: never
        Returns: {
          attempt_count: number
          delivery_id: string
          event_id: string
          event_name: string
          event_position: number
          event_schema_version: number
          lease_expires_at: string
          lease_token: string
          payload: Json
          workspace_id: string
        }[]
      }
      claim_phase0_probe_deliveries: {
        Args: never
        Returns: {
          attempt_count: number
          delivery_id: string
          event_id: string
          event_name: string
          event_position: number
          event_schema_version: number
          lease_expires_at: string
          lease_token: string
          metadata: Json
          payload: Json
          workspace_id: string
        }[]
      }
      claim_plan_snapshot_projection_v1: {
        Args: never
        Returns: {
          attempt_count: number
          attempt_id: string
          claim_as_of: string
          delivery_id: string
          event_id: string
          event_position: number
          generation: number
          lease_expires_at: string
          lease_token: string
          workspace_id: string
        }[]
      }
      claim_review_item_projection_v1: {
        Args: never
        Returns: {
          attempt_count: number
          delivery_id: string
          event_id: string
          event_name: string
          event_position: number
          event_schema_version: number
          lease_expires_at: string
          lease_token: string
          payload: Json
          workspace_id: string
        }[]
      }
      claim_target_readiness_projection_v1: {
        Args: never
        Returns: {
          attempt_count: number
          delivery_id: string
          event_id: string
          event_name: string
          event_position: number
          event_schema_version: number
          lease_expires_at: string
          lease_token: string
          payload: Json
          workspace_id: string
        }[]
      }
      complete_mastery_evidence_projection_v1: {
        Args: {
          p_delivery_id: string
          p_expected_event_position: number
          p_expected_input_watermark: number
          p_lease_token: string
          p_state: Json
        }
        Returns: boolean
      }
      complete_phase0_probe_delivery: {
        Args: {
          p_delivery_id: string
          p_expected_event_position: number
          p_lease_token: string
        }
        Returns: boolean
      }
      complete_plan_snapshot_projection_v1: {
        Args: {
          p_attempt_id: string
          p_delivery_id: string
          p_lease_token: string
          p_result: Json
        }
        Returns: string
      }
      complete_review_item_projection_v1: {
        Args: {
          p_delivery_id: string
          p_expected_event_position: number
          p_lease_token: string
          p_subjects: Json
        }
        Returns: boolean
      }
      complete_target_readiness_projection_v1: {
        Args: {
          p_delivery_id: string
          p_expected_event_position: number
          p_lease_token: string
          p_results: Json
        }
        Returns: boolean
      }
      create_personal_review_reminder_v1: {
        Args: {
          p_competency_ref: string
          p_dimension: string
          p_expected_subject_version: number
          p_idempotency_key: string
          p_local_due_at: string
        }
        Returns: Json
      }
      create_readiness_goal: {
        Args: {
          p_idempotency_key: string
          p_profile_version_key: string
          p_readiness_goal_key: string
          p_title: string
          p_workspace_id: string
        }
        Returns: Json
      }
      fail_mastery_evidence_projection_v1: {
        Args: {
          p_delivery_id: string
          p_error_code: string
          p_failure_class: string
          p_lease_token: string
        }
        Returns: string
      }
      fail_phase0_probe_delivery: {
        Args: {
          p_delivery_id: string
          p_error_code: string
          p_failure_class: string
          p_lease_token: string
        }
        Returns: string
      }
      fail_plan_snapshot_projection_v1: {
        Args: {
          p_attempt_id: string
          p_delivery_id: string
          p_error_code: string
          p_failure_class: string
          p_lease_token: string
        }
        Returns: string
      }
      fail_review_item_projection_v1: {
        Args: {
          p_delivery_id: string
          p_error_code: string
          p_failure_class: string
          p_lease_token: string
        }
        Returns: string
      }
      fail_target_readiness_projection_v1: {
        Args: {
          p_delivery_id: string
          p_error_code: string
          p_failure_class: string
          p_lease_token: string
        }
        Returns: string
      }
      finish_focus_activity_v1: {
        Args: {
          p_expected_version: number
          p_focus_session_id: string
          p_idempotency_key: string
          p_result_kind: string
          p_terminal_action: string
          p_used_hint: boolean
        }
        Returns: Json
      }
      get_available_target_profiles: {
        Args: { p_workspace_id: string }
        Returns: Json
      }
      get_current_competency_overlay_v1: {
        Args: { p_competency_ref: string; p_readiness_goal_key: string }
        Returns: Json
      }
      get_current_explore_source_v1: {
        Args: { p_readiness_goal_key: string; p_selected_activity_key?: string }
        Returns: Json
      }
      get_current_growth_plan_v1: { Args: never; Returns: Json }
      get_current_learning_tracks_v1: { Args: never; Returns: Json }
      get_current_planning_readiness_input_v1: {
        Args: { p_readiness_goal_key: string }
        Returns: Json
      }
      get_explore_target_context_v1: {
        Args: { p_readiness_goal_key: string }
        Returns: Json
      }
      get_focus_from_plan_v1: {
        Args: { p_selection_ref: string }
        Returns: Json
      }
      get_focus_workspace_v1: {
        Args: { p_activity_key?: string; p_readiness_goal_key: string }
        Returns: Json
      }
      get_growth_plan_setup_source_v1: { Args: never; Returns: Json }
      get_learning_track_creation_source_v1: { Args: never; Returns: Json }
      get_learning_track_activity_admission_source_v1: {
        Args: never
        Returns: Json
      }
      get_mastery_projection_health_v1: { Args: never; Returns: Json }
      get_plan_snapshot_projection_health_v1: { Args: never; Returns: Json }
      get_readiness_goal: {
        Args: { p_readiness_goal_key: string; p_workspace_id: string }
        Returns: Json
      }
      get_review_projection_health_v1: { Args: never; Returns: Json }
      get_review_workspace_v1: { Args: never; Returns: Json }
      get_target_profile: {
        Args: { p_profile_version_key: string; p_workspace_id: string }
        Returns: Json
      }
      get_target_readiness_projection_health_v1: { Args: never; Returns: Json }
      get_target_readiness_v1: {
        Args: { p_readiness_goal_key: string }
        Returns: Json
      }
      get_target_selection_source_v1: { Args: never; Returns: Json }
      get_today_workspace_v1: { Args: never; Returns: Json }
      get_workspace: { Args: { p_workspace_id: string }; Returns: Json }
      initialize_growth_plan_v1: {
        Args: {
          p_default_session_minutes: number
          p_idempotency_key: string
          p_protected_minimum_minutes: number
          p_readiness_goal_key: string
          p_track_priority: number
          p_weekly_capacity_minutes: number
        }
        Returns: Json
      }
      invalidate_evidence_v1: {
        Args: {
          p_evidence_id: string
          p_idempotency_key: string
          p_reason: string
        }
        Returns: Json
      }
      load_mastery_evidence_projection_v1: {
        Args: { p_delivery_id: string; p_lease_token: string }
        Returns: Json
      }
      load_plan_snapshot_projection_v1: {
        Args: {
          p_attempt_id: string
          p_delivery_id: string
          p_lease_token: string
        }
        Returns: Json
      }
      load_review_item_projection_v1: {
        Args: { p_delivery_id: string; p_lease_token: string }
        Returns: Json
      }
      load_target_readiness_projection_v1: {
        Args: { p_delivery_id: string; p_lease_token: string }
        Returns: Json
      }
      preview_growth_plan_capacity_v1: {
        Args: {
          p_expected_growth_plan_version: string
          p_proposed_weekly_capacity_minutes: number
          p_reason: string
        }
        Returns: Json
      }
      preview_growth_plan_initialization_v1: {
        Args: {
          p_default_session_minutes: number
          p_expected_readiness_goal_version: string
          p_idempotency_key: string
          p_readiness_goal_key: string
          p_reason: string
          p_track_priority: number
          p_weekly_capacity_minutes: number
        }
        Returns: Json
      }
      preview_learning_track_creation_v1: {
        Args: {
          p_default_session_minutes: number
          p_expected_growth_plan_version: string
          p_expected_readiness_goal_version: string
          p_priority: number
          p_readiness_goal_key: string
          p_reason: string
          p_request_id: string
          p_title: string
        }
        Returns: Json
      }
      preview_growth_plan_lifecycle_v1: {
        Args: {
          p_expected_growth_plan_version: string
          p_operation: string
          p_reason: string
        }
        Returns: Json
      }
      preview_learning_track_activity_admission_v1: {
        Args: {
          p_activity_key: string
          p_energy: string
          p_estimated_minutes: number
          p_expected_growth_plan_version: string
          p_expected_learning_track_version: string
          p_reason: string
          p_request_id: string
        }
        Returns: Json
      }
      preview_learning_track_lifecycle_v1: {
        Args: {
          p_expected_growth_plan_version: string
          p_expected_learning_track_version: string
          p_operation: string
          p_reason: string
          p_track_key: string
        }
        Returns: Json
      }
      preview_learning_track_priority_minimum_v1: {
        Args: {
          p_expected_growth_plan_version: string
          p_expected_learning_track_version: string
          p_priority: number
          p_protected_minimum_minutes: number
          p_reason: string
          p_track_key: string
        }
        Returns: Json
      }
      record_plan_snapshot_input_v1: {
        Args: {
          p_attempt_id: string
          p_delivery_id: string
          p_input: Json
          p_lease_token: string
          p_source_fence: string
        }
        Returns: boolean
      }
      reschedule_review_reason_v1: {
        Args: {
          p_expected_projection_version: number
          p_expected_source_revision: number
          p_idempotency_key: string
          p_local_due_at: string
          p_reason_id: string
          p_subject_id: string
        }
        Returns: Json
      }
      reset_overlay_position: {
        Args: {
          p_expected_overlay_version: number
          p_idempotency_key: string
          p_node_ref: string
          p_readiness_goal_key: string
          p_workspace_id: string
        }
        Returns: Json
      }
      restore_review_reason_v1: {
        Args: {
          p_expected_projection_version: number
          p_expected_source_revision: number
          p_idempotency_key: string
          p_reason_id: string
          p_subject_id: string
        }
        Returns: Json
      }
      save_current_overlay_note_v1: {
        Args: {
          p_competency_ref: string
          p_expected_overlay_version: string
          p_idempotency_key: string
          p_note_body: string
          p_readiness_goal_key: string
        }
        Returns: Json
      }
      set_overlay_position: {
        Args: {
          p_expected_overlay_version: number
          p_idempotency_key: string
          p_node_ref: string
          p_readiness_goal_key: string
          p_workspace_id: string
          p_x: number
          p_y: number
        }
        Returns: Json
      }
      skip_review_reason_once_v1: {
        Args: {
          p_expected_projection_version: number
          p_expected_source_revision: number
          p_idempotency_key: string
          p_reason_id: string
          p_subject_id: string
        }
        Returns: Json
      }
      start_focus_activity_v1: {
        Args: {
          p_activity_key: string
          p_idempotency_key: string
          p_planned_minutes: number
          p_readiness_goal_key: string
        }
        Returns: Json
      }
      start_focus_from_plan_v1: {
        Args: { p_idempotency_key: string; p_selection_ref: string }
        Returns: Json
      }
      suppress_review_reason_v1: {
        Args: {
          p_expected_projection_version: number
          p_expected_source_revision: number
          p_idempotency_key: string
          p_reason_id: string
          p_subject_id: string
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
  api: {
    Enums: {},
  },
} as const
