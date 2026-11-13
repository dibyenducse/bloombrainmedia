-- BloomBrain Media payments ledger storage for Supabase.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

create table if not exists public.ledger_store (
  id text primary key,
  data jsonb not null,
  rev bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.ledger_backups (
  id bigint generated always as identity primary key,
  ledger_id text not null,
  rev bigint not null,
  data jsonb not null,
  created_at timestamptz not null default now()
);

-- Private data: RLS on with no policies, so only the server's service-role key can
-- read or write. The public anon key gets nothing.
alter table public.ledger_store enable row level security;
alter table public.ledger_backups enable row level security;
revoke all on public.ledger_store, public.ledger_backups from anon, authenticated;

-- Atomic compare-and-swap: saves only if nobody else saved since p_rev was read,
-- keeps the previous version as a backup, and retains the latest 100 backups.
create or replace function public.ledger_commit(p_id text, p_rev bigint, p_data jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  old_data jsonb;
begin
  select data into old_data from ledger_store where id = p_id and rev = p_rev for update;
  if not found then
    return false;
  end if;
  insert into ledger_backups (ledger_id, rev, data) values (p_id, p_rev, old_data);
  update ledger_store set data = p_data, rev = p_rev + 1, updated_at = now() where id = p_id;
  delete from ledger_backups
   where ledger_id = p_id
     and id not in (select id from ledger_backups where ledger_id = p_id order by id desc limit 100);
  return true;
end;
$$;

revoke all on function public.ledger_commit(text, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.ledger_commit(text, bigint, jsonb) to service_role;
