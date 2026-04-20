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
      pothole_documents: {
        Row: {
          assigned_to: string
          created_at: string
          due_date: string
          id: string
          pothole_id: string | null
          priority: string
          status: string
          title: string
          type: string
        }
        Insert: {
          assigned_to: string
          created_at?: string
          due_date: string
          id?: string
          pothole_id?: string | null
          priority: string
          status: string
          title: string
          type: string
        }
        Update: {
          assigned_to?: string
          created_at?: string
          due_date?: string
          id?: string
          pothole_id?: string | null
          priority?: string
          status?: string
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "pothole_documents_pothole_id_fkey"
            columns: ["pothole_id"]
            isOneToOne: false
            referencedRelation: "potholes"
            referencedColumns: ["id"]
          },
        ]
      }
      potholes: {
        Row: {
          bbox_xyxy: Json | null
          capture_ts: string | null
          completion_date: string | null
          created_at: string
          description: string | null
          detection_accuracy: number
          distance_m: number | null
          frame_height: number | null
          frame_width: number | null
          fusion_error: string | null
          fusion_extra: Json | null
          fusion_idempotency_key: string | null
          fusion_ok: boolean | null
          fusion_ts: string | null
          id: string
          image_url: string | null
          frame_image_url: string | null
          interior_depth_m: number | null
          latitude: number
          length_m: number | null
          lidar_data: Json | null
          longitude: number
          model_url: string | null
          pothole_number: number
          report_date: string
          reported_by: string | null
          road_id: string
          scheduled_repair_date: string | null
          severity: string
          source: string
          status: string
          surface_area_m2: number | null
          track_id: number | null
          updated_at: string
          video_url: string | null
          width_m: number | null
          yolo_confidence: number | null
        }
        Insert: {
          bbox_xyxy?: Json | null
          capture_ts?: string | null
          completion_date?: string | null
          created_at?: string
          description?: string | null
          detection_accuracy: number
          distance_m?: number | null
          frame_height?: number | null
          frame_width?: number | null
          fusion_error?: string | null
          fusion_extra?: Json | null
          fusion_idempotency_key?: string | null
          fusion_ok?: boolean | null
          fusion_ts?: string | null
          id?: string
          image_url?: string | null
          frame_image_url?: string | null
          interior_depth_m?: number | null
          latitude: number
          length_m?: number | null
          lidar_data?: Json | null
          longitude: number
          model_url?: string | null
          pothole_number: number
          report_date?: string
          reported_by?: string | null
          road_id: string
          scheduled_repair_date?: string | null
          severity: string
          source?: string
          status: string
          surface_area_m2?: number | null
          track_id?: number | null
          updated_at?: string
          video_url?: string | null
          width_m?: number | null
          yolo_confidence?: number | null
        }
        Update: {
          bbox_xyxy?: Json | null
          capture_ts?: string | null
          completion_date?: string | null
          created_at?: string
          description?: string | null
          detection_accuracy?: number
          distance_m?: number | null
          frame_height?: number | null
          frame_width?: number | null
          fusion_error?: string | null
          fusion_extra?: Json | null
          fusion_idempotency_key?: string | null
          fusion_ok?: boolean | null
          fusion_ts?: string | null
          id?: string
          image_url?: string | null
          frame_image_url?: string | null
          interior_depth_m?: number | null
          latitude?: number
          length_m?: number | null
          lidar_data?: Json | null
          longitude?: number
          model_url?: string | null
          pothole_number?: number
          report_date?: string
          reported_by?: string | null
          road_id?: string
          scheduled_repair_date?: string | null
          severity?: string
          source?: string
          status?: string
          surface_area_m2?: number | null
          track_id?: number | null
          updated_at?: string
          video_url?: string | null
          width_m?: number | null
          yolo_confidence?: number | null
        }
        Relationships: []
      }
      processing_tasks: {
        Row: {
          created_at: string | null
          error_message: string | null
          external_task_id: string
          id: string
          model_url: string | null
          pothole_id: string | null
          progress: number | null
          status: string
          status_message: string | null
          updated_at: string | null
          video_url: string | null
        }
        Insert: {
          created_at?: string | null
          error_message?: string | null
          external_task_id: string
          id?: string
          model_url?: string | null
          pothole_id?: string | null
          progress?: number | null
          status: string
          status_message?: string | null
          updated_at?: string | null
          video_url?: string | null
        }
        Update: {
          created_at?: string | null
          error_message?: string | null
          external_task_id?: string
          id?: string
          model_url?: string | null
          pothole_id?: string | null
          progress?: number | null
          status?: string
          status_message?: string | null
          updated_at?: string | null
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "processing_tasks_pothole_id_fkey"
            columns: ["pothole_id"]
            isOneToOne: false
            referencedRelation: "potholes"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
  public: {
    Enums: {},
  },
} as const
