-- ALEPH T04 only needs one persistent application-state row.
-- The JSON state itself contains at most two distinct KST daily readings.
create table if not exists public.t04_state (
  state_key text primary key,
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  version bigint not null default 1 check (version >= 1),
  updated_at timestamptz not null default now(),
  constraint t04_state_live_only check (state_key = 'live')
);

alter table public.t04_state enable row level security;

-- The browser never talks to Supabase directly. No public/authenticated grants or RLS policies.
revoke all on table public.t04_state from anon, authenticated;
grant select, insert, update on table public.t04_state to service_role;

comment on table public.t04_state is
  'ALEPH T04 temporary persistent state. One live row only; no user or raw attack records.';
