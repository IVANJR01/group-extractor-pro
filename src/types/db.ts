export type ValidationStatus = 'valid' | 'foreign' | 'needs_review' | 'incomplete' | 'invalid_area_code' | 'invalid' | 'erased';
export type ConsentStatus = 'pending' | 'authorized' | 'revoked' | 'blocked';
export type SourceType = 'group' | 'customer_list' | 'authorized_list' | 'form' | 'manual' | 'other';
export type JobStatus = 'pending' | 'uploading' | 'processing' | 'completed' | 'failed' | 'cancelled';
export type InvitationEventType =
  | 'prepared' | 'shared' | 'sent_via_integration' | 'delivery_confirmed'
  | 'join_confirmed' | 'no_confirmation' | 'declined' | 'opt_out';

export interface ContactSource {
  id: string; user_id: string; name: string; source_type: SourceType; description: string | null;
  status: 'active' | 'archived'; created_at: string; updated_at: string;
}

export interface ImportJob {
  id: string; source_id: string; file_name: string; file_type: string; file_size: number | null; status: JobStatus;
  total_rows: number; uploaded_rows: number; processed_rows: number; valid_rows: number; invalid_rows: number;
  duplicate_rows: number; new_contacts: number; name_conflicts: number; error_details: { at: string; message: string }[];
  cancel_requested: boolean; created_at: string; completed_at: string | null; started_at: string | null;
}

export interface ContactOverview {
  id: string; name: string | null; original_phone: string | null; normalized_phone: string | null; country_code: string | null;
  area_code: string | null; uf: string | null; national_number: string | null; line_type: string | null;
  validation_status: ValidationStatus; validation_issues: string[]; name_conflicts: string[];
  consent_status: ConsentStatus; consent_updated_at: string | null; first_source_id: string | null;
  created_at: string; updated_at: string; source_ids: string[]; occurrences: number; suppressed: boolean;
  last_event_type: InvitationEventType | null; last_event_at: string | null; campaign_ids: string[];
}

export interface DestinationGroup {
  id: string; name: string; description: string | null; invite_url: string | null; invite_link_status: 'active' | 'disabled';
  invite_link_updated_at: string | null; status: 'active' | 'inactive'; created_at: string; updated_at: string;
}

export interface Segment { id: string; name: string; description: string | null; filter_definition: SegmentFilter; created_at: string; updated_at: string }

export interface SegmentFilter {
  source_ids?: string[];
  source_match?: 'any' | 'all';
  area_codes?: string[];
  ufs?: string[];
  consent_statuses?: ConsentStatus[];
  validation_statuses?: ValidationStatus[];
  imported_from?: string;
  imported_to?: string;
  invite_status?: 'never' | 'invited';
  include_suppressed?: boolean;
  search?: string;
  destination_group_id?: string;
}

export interface Campaign {
  id: string; destination_group_id: string; segment_id: string | null; name: string; message_body: string;
  status: 'draft' | 'active' | 'completed' | 'cancelled'; eligible_count: number; excluded_count: number;
  created_at: string; completed_at: string | null;
}

export interface MessageTemplate { id: string; name: string; body: string; created_at: string }

export interface AuditLog { id: string; action: string; entity_type: string; entity_id: string | null; metadata: Record<string, unknown>; created_at: string }

export interface DashboardData {
  kpis: {
    total_contacts: number; imported_this_month: number; unique_contacts: number; duplicate_occurrences: number;
    invalid_contacts: number; authorized: number; without_consent: number; blocked_or_revoked: number;
    invites_shared: number; joins_confirmed: number;
  };
  imports_by_day: { day: string; rows: number; new: number }[];
  by_source: { source: string; contacts: number }[];
  by_ddd: { ddd: string; contacts: number }[];
  duplicates_by_import: { file: string; duplicates: number; at: string }[];
  joins_by_day: { day: string; shared: number; joined: number }[];
  consent_distribution: { status: ConsentStatus; contacts: number }[];
  recent_activity: { action: string; entity_type: string; entity_id: string | null; metadata: Record<string, unknown>; created_at: string }[];
}

export interface SignupForm {
  id: string; slug: string; title: string; description: string | null; organizer_name: string; consent_text: string;
  destination_group_id: string | null; source_id: string; status: 'active' | 'paused'; created_at: string; updated_at: string;
  signup_submissions?: { count: number }[];
}
export interface SignupSubmission {
  id: string; form_id: string; contact_id: string | null; name: string | null; phone: string | null;
  outcome: 'new' | 'existing' | 'suppressed'; created_at: string;
}
export interface PublicSignupForm { title: string; description: string | null; organizer_name: string; consent_text: string; group_name: string | null }
