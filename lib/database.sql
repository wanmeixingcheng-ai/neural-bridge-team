create table if not exists nb_users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  display_name text not null,
  role text not null default 'admin',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists nb_audit_events (
  id uuid primary key,
  created_at timestamptz not null,
  event_type text not null,
  actor text not null,
  ip_address text not null,
  user_agent text not null,
  target text not null,
  status text not null,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists nb_audit_events_created_at_idx on nb_audit_events (created_at desc);
create index if not exists nb_audit_events_type_idx on nb_audit_events (event_type);

create table if not exists nb_source_registry (
  id text primary key,
  source_type text not null,
  title text not null,
  origin_url text not null default '',
  provider text not null default '',
  jurisdiction text not null default 'JP',
  collected_by text not null default 'user',
  collection_method text not null default 'manual',
  license text not null default '',
  consent_scope text not null default 'none',
  training_allowed boolean not null default false,
  deletion_requested boolean not null default false,
  retention_policy text not null default 'project_local_default',
  review_status text not null default 'candidate',
  risk_level text not null default 'medium',
  version integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nb_source_registry_review_status_chk check (review_status in ('draft', 'candidate', 'in_review', 'approved', 'rejected', 'archived')),
  constraint nb_source_registry_risk_level_chk check (risk_level in ('low', 'medium', 'high', 'restricted')),
  constraint nb_source_registry_version_chk check (version >= 1),
  constraint nb_source_registry_metadata_object_chk check (jsonb_typeof(metadata) = 'object'),
  constraint nb_source_registry_reins_collection_boundary_chk check (
    source_type <> 'reins_user_upload' or collection_method in ('manual', 'user_upload', 'user_manual_upload')
  ),
  constraint nb_source_registry_high_risk_review_metadata_chk check (
    review_status <> 'approved' or risk_level not in ('high', 'restricted') or (
      length(trim(metadata->>'reviewed_by')) > 0 and length(trim(metadata->>'reviewed_at')) > 0
    )
  ),
  constraint nb_source_registry_training_boundary_chk check (
    training_allowed = false or (
      consent_scope in ('opt_in', 'explicit_opt_in') and
      deletion_requested = false and
      risk_level not in ('high', 'restricted') and
      source_type not in ('reins_user_upload', 'contract', 'important_matter_explanation', 'customer_record')
    )
  )
);

create table if not exists nb_knowledge_units (
  id text primary key,
  source_id text not null references nb_source_registry(id),
  domain text not null,
  title text not null,
  content text not null,
  locale text not null default 'ja-JP',
  tags jsonb not null default '[]'::jsonb,
  evidence_ref_ids jsonb not null default '[]'::jsonb,
  supersedes_id text not null default '',
  review_status text not null default 'candidate',
  risk_level text not null default 'medium',
  version integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nb_knowledge_units_review_status_chk check (review_status in ('draft', 'candidate', 'in_review', 'approved', 'rejected', 'archived')),
  constraint nb_knowledge_units_risk_level_chk check (risk_level in ('low', 'medium', 'high', 'restricted')),
  constraint nb_knowledge_units_version_chk check (version >= 1),
  constraint nb_knowledge_units_domain_chk check (length(trim(domain)) > 0),
  constraint nb_knowledge_units_title_chk check (length(trim(title)) > 0),
  constraint nb_knowledge_units_content_chk check (length(trim(content)) >= 12),
  constraint nb_knowledge_units_tags_array_chk check (jsonb_typeof(tags) = 'array'),
  constraint nb_knowledge_units_evidence_ref_ids_array_chk check (jsonb_typeof(evidence_ref_ids) = 'array'),
  constraint nb_knowledge_units_metadata_object_chk check (jsonb_typeof(metadata) = 'object'),
  constraint nb_knowledge_units_high_risk_review_metadata_chk check (
    review_status <> 'approved' or risk_level not in ('high', 'restricted') or (
      length(trim(metadata->>'reviewed_by')) > 0 and length(trim(metadata->>'reviewed_at')) > 0
    )
  )
);

create table if not exists nb_policy_rules (
  id text primary key,
  source_id text not null references nb_source_registry(id),
  rule_type text not null,
  title text not null,
  rule_text text not null,
  applies_to jsonb not null default '[]'::jsonb,
  requires_expert_confirmation boolean not null default true,
  evidence_ref_ids jsonb not null default '[]'::jsonb,
  review_status text not null default 'in_review',
  risk_level text not null default 'high',
  version integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nb_policy_rules_review_status_chk check (review_status in ('draft', 'candidate', 'in_review', 'approved', 'rejected', 'archived')),
  constraint nb_policy_rules_risk_level_chk check (risk_level in ('low', 'medium', 'high', 'restricted')),
  constraint nb_policy_rules_version_chk check (version >= 1),
  constraint nb_policy_rules_core_text_chk check (length(trim(rule_type)) > 0 and length(trim(title)) > 0 and length(trim(rule_text)) > 0),
  constraint nb_policy_rules_applies_to_array_chk check (jsonb_typeof(applies_to) = 'array'),
  constraint nb_policy_rules_evidence_ref_ids_array_chk check (jsonb_typeof(evidence_ref_ids) = 'array'),
  constraint nb_policy_rules_metadata_object_chk check (jsonb_typeof(metadata) = 'object'),
  constraint nb_policy_rules_high_risk_review_metadata_chk check (
    review_status <> 'approved' or risk_level not in ('high', 'restricted') or (
      length(trim(metadata->>'reviewed_by')) > 0 and length(trim(metadata->>'reviewed_at')) > 0
    )
  )
);

create table if not exists nb_scenarios (
  id text primary key,
  source_id text not null references nb_source_registry(id),
  scenario_type text not null,
  title text not null,
  description text not null,
  expected_outputs jsonb not null default '[]'::jsonb,
  evidence_ref_ids jsonb not null default '[]'::jsonb,
  review_status text not null default 'candidate',
  risk_level text not null default 'medium',
  version integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nb_scenarios_review_status_chk check (review_status in ('draft', 'candidate', 'in_review', 'approved', 'rejected', 'archived')),
  constraint nb_scenarios_risk_level_chk check (risk_level in ('low', 'medium', 'high', 'restricted')),
  constraint nb_scenarios_version_chk check (version >= 1),
  constraint nb_scenarios_core_text_chk check (length(trim(scenario_type)) > 0 and length(trim(title)) > 0 and length(trim(description)) > 0),
  constraint nb_scenarios_expected_outputs_array_chk check (jsonb_typeof(expected_outputs) = 'array'),
  constraint nb_scenarios_evidence_ref_ids_array_chk check (jsonb_typeof(evidence_ref_ids) = 'array'),
  constraint nb_scenarios_metadata_object_chk check (jsonb_typeof(metadata) = 'object'),
  constraint nb_scenarios_high_risk_review_metadata_chk check (
    review_status <> 'approved' or risk_level not in ('high', 'restricted') or (
      length(trim(metadata->>'reviewed_by')) > 0 and length(trim(metadata->>'reviewed_at')) > 0
    )
  )
);

create table if not exists nb_eval_cases (
  id text primary key,
  source_id text not null references nb_source_registry(id),
  scenario_id text not null default '',
  prompt text not null,
  expected_behavior text not null,
  forbidden_behavior text not null default '',
  scoring_rubric jsonb not null default '{}'::jsonb,
  evidence_ref_ids jsonb not null default '[]'::jsonb,
  review_status text not null default 'candidate',
  risk_level text not null default 'medium',
  version integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nb_eval_cases_review_status_chk check (review_status in ('draft', 'candidate', 'in_review', 'approved', 'rejected', 'archived')),
  constraint nb_eval_cases_risk_level_chk check (risk_level in ('low', 'medium', 'high', 'restricted')),
  constraint nb_eval_cases_version_chk check (version >= 1),
  constraint nb_eval_cases_core_text_chk check (length(trim(prompt)) > 0 and length(trim(expected_behavior)) > 0),
  constraint nb_eval_cases_scoring_rubric_object_chk check (jsonb_typeof(scoring_rubric) = 'object'),
  constraint nb_eval_cases_evidence_ref_ids_array_chk check (jsonb_typeof(evidence_ref_ids) = 'array'),
  constraint nb_eval_cases_metadata_object_chk check (jsonb_typeof(metadata) = 'object'),
  constraint nb_eval_cases_high_risk_review_metadata_chk check (
    review_status <> 'approved' or risk_level not in ('high', 'restricted') or (
      length(trim(metadata->>'reviewed_by')) > 0 and length(trim(metadata->>'reviewed_at')) > 0
    )
  )
);

create table if not exists nb_evidence_refs (
  id text primary key,
  source_id text not null references nb_source_registry(id),
  target_type text not null,
  target_id text not null,
  locator text not null,
  quote text not null default '',
  hash text not null default '',
  review_status text not null default 'candidate',
  risk_level text not null default 'medium',
  version integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nb_evidence_refs_review_status_chk check (review_status in ('draft', 'candidate', 'in_review', 'approved', 'rejected', 'archived')),
  constraint nb_evidence_refs_risk_level_chk check (risk_level in ('low', 'medium', 'high', 'restricted')),
  constraint nb_evidence_refs_version_chk check (version >= 1),
  constraint nb_evidence_refs_locator_chk check (length(trim(locator)) > 0),
  constraint nb_evidence_refs_quote_or_hash_chk check (length(trim(quote)) > 0 or length(trim(hash)) > 0),
  constraint nb_evidence_refs_metadata_object_chk check (jsonb_typeof(metadata) = 'object'),
  constraint nb_evidence_refs_high_risk_review_metadata_chk check (
    review_status <> 'approved' or risk_level not in ('high', 'restricted') or (
      length(trim(metadata->>'reviewed_by')) > 0 and length(trim(metadata->>'reviewed_at')) > 0
    )
  )
);

create table if not exists nb_jre_records (
  id text primary key,
  entity_type text not null,
  source_id text not null references nb_source_registry(id),
  property_id text not null default '',
  title text not null,
  locale text not null default 'ja-JP',
  calculation_method text not null default 'source_reported',
  attributes jsonb not null default '{}'::jsonb,
  evidence_ref_ids jsonb not null default '[]'::jsonb,
  review_status text not null default 'candidate',
  risk_level text not null default 'medium',
  version integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nb_jre_records_entity_type_chk check (entity_type in ('property', 'land', 'building', 'lease', 'expense', 'loan', 'tax', 'risk', 'area', 'transaction')),
  constraint nb_jre_records_calculation_method_chk check (calculation_method in ('source_reported', 'deterministic_code', 'manual_entry', 'unknown')),
  constraint nb_jre_records_review_status_chk check (review_status in ('draft', 'candidate', 'in_review', 'approved', 'rejected', 'archived')),
  constraint nb_jre_records_risk_level_chk check (risk_level in ('low', 'medium', 'high', 'restricted')),
  constraint nb_jre_records_version_chk check (version >= 1),
  constraint nb_jre_records_title_chk check (length(trim(title)) > 0),
  constraint nb_jre_records_property_id_chk check (entity_type = 'property' or length(trim(property_id)) > 0),
  constraint nb_jre_records_attributes_object_chk check (jsonb_typeof(attributes) = 'object'),
  constraint nb_jre_records_evidence_ref_ids_array_chk check (jsonb_typeof(evidence_ref_ids) = 'array'),
  constraint nb_jre_records_metadata_object_chk check (jsonb_typeof(metadata) = 'object'),
  constraint nb_jre_records_high_risk_review_metadata_chk check (
    review_status <> 'approved' or risk_level not in ('high', 'restricted') or (
      length(trim(metadata->>'reviewed_by')) > 0 and length(trim(metadata->>'reviewed_at')) > 0
    )
  )
);

create table if not exists nb_calculation_runs (
  id text primary key,
  property_id text not null,
  calculation_type text not null,
  calculation_method text not null default 'deterministic_code',
  inputs jsonb not null default '{}'::jsonb,
  formulas jsonb not null default '{}'::jsonb,
  outputs jsonb not null default '{}'::jsonb,
  source_ids jsonb not null default '[]'::jsonb,
  evidence_ref_ids jsonb not null default '[]'::jsonb,
  dossier_snapshot jsonb not null default '{}'::jsonb,
  review_status text not null default 'candidate',
  risk_level text not null default 'medium',
  version integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nb_calculation_runs_method_chk check (calculation_method = 'deterministic_code'),
  constraint nb_calculation_runs_review_status_chk check (review_status in ('draft', 'candidate', 'in_review', 'approved', 'rejected', 'archived')),
  constraint nb_calculation_runs_risk_level_chk check (risk_level in ('low', 'medium', 'high', 'restricted')),
  constraint nb_calculation_runs_version_chk check (version >= 1),
  constraint nb_calculation_runs_payload_chk check (
    inputs <> '{}'::jsonb and
    formulas <> '{}'::jsonb and
    outputs <> '{}'::jsonb and
    jsonb_typeof(inputs) = 'object' and
    jsonb_typeof(formulas) = 'object' and
    jsonb_typeof(outputs) = 'object' and
    jsonb_typeof(dossier_snapshot) = 'object' and
    jsonb_typeof(metadata) = 'object' and
    (
      review_status <> 'approved' or risk_level not in ('high', 'restricted') or (
        length(trim(metadata->>'reviewed_by')) > 0 and length(trim(metadata->>'reviewed_at')) > 0
      )
    ) and
    jsonb_typeof(source_ids) = 'array' and
    jsonb_typeof(evidence_ref_ids) = 'array' and
    jsonb_array_length(source_ids) > 0 and
    jsonb_array_length(evidence_ref_ids) > 0
  )
);

create index if not exists nb_source_registry_type_idx on nb_source_registry (source_type);
create index if not exists nb_source_registry_review_idx on nb_source_registry (review_status);
create index if not exists nb_source_registry_risk_idx on nb_source_registry (risk_level);
create index if not exists nb_source_registry_training_idx on nb_source_registry (training_allowed);
create index if not exists nb_source_registry_consent_idx on nb_source_registry (consent_scope);
create index if not exists nb_source_registry_deletion_idx on nb_source_registry (deletion_requested);
create index if not exists nb_source_registry_type_review_idx on nb_source_registry (source_type, review_status);
create index if not exists nb_knowledge_units_source_idx on nb_knowledge_units (source_id);
create index if not exists nb_knowledge_units_domain_idx on nb_knowledge_units (domain);
create index if not exists nb_knowledge_units_review_idx on nb_knowledge_units (review_status);
create index if not exists nb_knowledge_units_risk_idx on nb_knowledge_units (risk_level);
create index if not exists nb_knowledge_units_source_review_idx on nb_knowledge_units (source_id, review_status);
create index if not exists nb_policy_rules_source_idx on nb_policy_rules (source_id);
create index if not exists nb_policy_rules_type_idx on nb_policy_rules (rule_type);
create index if not exists nb_policy_rules_review_idx on nb_policy_rules (review_status);
create index if not exists nb_policy_rules_risk_idx on nb_policy_rules (risk_level);
create index if not exists nb_policy_rules_source_review_idx on nb_policy_rules (source_id, review_status);
create index if not exists nb_scenarios_source_idx on nb_scenarios (source_id);
create index if not exists nb_scenarios_type_idx on nb_scenarios (scenario_type);
create index if not exists nb_scenarios_review_idx on nb_scenarios (review_status);
create index if not exists nb_scenarios_risk_idx on nb_scenarios (risk_level);
create index if not exists nb_scenarios_source_review_idx on nb_scenarios (source_id, review_status);
create index if not exists nb_eval_cases_source_idx on nb_eval_cases (source_id);
create index if not exists nb_eval_cases_scenario_idx on nb_eval_cases (scenario_id);
create index if not exists nb_eval_cases_review_idx on nb_eval_cases (review_status);
create index if not exists nb_eval_cases_risk_idx on nb_eval_cases (risk_level);
create index if not exists nb_eval_cases_source_review_idx on nb_eval_cases (source_id, review_status);
create index if not exists nb_evidence_refs_source_idx on nb_evidence_refs (source_id);
create index if not exists nb_evidence_refs_target_idx on nb_evidence_refs (target_type, target_id);
create index if not exists nb_evidence_refs_review_idx on nb_evidence_refs (review_status);
create index if not exists nb_evidence_refs_risk_idx on nb_evidence_refs (risk_level);
create index if not exists nb_evidence_refs_target_review_idx on nb_evidence_refs (target_type, target_id, review_status);
create index if not exists nb_jre_records_entity_type_idx on nb_jre_records (entity_type);
create index if not exists nb_jre_records_source_idx on nb_jre_records (source_id);
create index if not exists nb_jre_records_property_idx on nb_jre_records (property_id);
create index if not exists nb_jre_records_review_idx on nb_jre_records (review_status);
create index if not exists nb_jre_records_risk_idx on nb_jre_records (risk_level);
create index if not exists nb_jre_records_property_review_idx on nb_jre_records (property_id, review_status);
create index if not exists nb_calculation_runs_property_idx on nb_calculation_runs (property_id);
create index if not exists nb_calculation_runs_type_idx on nb_calculation_runs (calculation_type);
create index if not exists nb_calculation_runs_review_idx on nb_calculation_runs (review_status);
create index if not exists nb_calculation_runs_risk_idx on nb_calculation_runs (risk_level);
create index if not exists nb_calculation_runs_property_type_idx on nb_calculation_runs (property_id, calculation_type);
create index if not exists nb_calculation_runs_source_ids_idx on nb_calculation_runs using gin (source_ids);
create index if not exists nb_calculation_runs_evidence_ref_ids_idx on nb_calculation_runs using gin (evidence_ref_ids);
