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
