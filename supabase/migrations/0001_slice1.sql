-- Slice 1: webhook loop. Orders, order_items and order_events come with slice 2.
-- Every table carries tenant_id. RLS is on with no policies: only the server-side key can read or write.

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text not null default 'dev',
  created_at timestamptz not null default now()
);

create table public.whatsapp_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  waba_id text not null,
  phone_number_id text not null unique,
  display_name text,
  -- Name of the environment variable that holds the access token. Never the token itself.
  token_ref text not null
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  wa_id text not null,
  name text,
  language text,
  opted_in_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, wa_id)
);

-- Deviation from the brief: phone_number_id, reply_to_wa_message_id, attempts, next_attempt_at
-- and last_error are added so slice 1 can link replies and retry sends.
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  contact_id uuid not null references public.contacts(id),
  phone_number_id text not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  wa_message_id text unique,
  type text not null,
  body text,
  status text not null check (status in ('received', 'pending', 'sent', 'delivered', 'read', 'failed')),
  trace_id text not null,
  reply_to_wa_message_id text unique,
  attempts int not null default 0,
  next_attempt_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create index messages_due_idx on public.messages (next_attempt_at) where status = 'pending';
create index messages_contact_idx on public.messages (tenant_id, contact_id, created_at);

create table public.dead_letters (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  message_id uuid references public.messages(id),
  payload jsonb not null,
  error text not null,
  attempts int not null,
  created_at timestamptz not null default now()
);

alter table public.tenants enable row level security;
alter table public.whatsapp_accounts enable row level security;
alter table public.contacts enable row level security;
alter table public.messages enable row level security;
alter table public.dead_letters enable row level security;
