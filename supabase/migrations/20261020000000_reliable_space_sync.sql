-- Additive sync metadata for MySpaces. Existing spaces and auth data are preserved.
-- Apply this migration to the Supabase project before releasing the extension's
-- realtime-sync build.

create table if not exists public.space_sync_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  space_id uuid not null,
  revision bigint not null default 1,
  deleted boolean not null default false,
  snapshot jsonb,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, space_id),
  constraint space_sync_state_snapshot_matches_deleted check (
    (deleted and snapshot is null) or (not deleted and snapshot is not null)
  )
);

create index if not exists space_sync_state_user_updated_idx
  on public.space_sync_state (user_id, updated_at desc);

alter table public.space_sync_state enable row level security;
drop policy if exists "Users can read their own MySpaces sync state" on public.space_sync_state;
create policy "Users can read their own MySpaces sync state"
  on public.space_sync_state for select to authenticated
  using (auth.uid() = user_id);

grant select on public.space_sync_state to authenticated;

create or replace function public.myspaces_set_space_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.updated_at := greatest(coalesce(new.updated_at, clock_timestamp()), clock_timestamp());
  else
    new.updated_at := greatest(
      coalesce(new.updated_at, clock_timestamp()),
      clock_timestamp(),
      old.updated_at + interval '1 microsecond'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists myspaces_set_space_updated_at on public.spaces;
create trigger myspaces_set_space_updated_at
  before insert or update on public.spaces
  for each row execute function public.myspaces_set_space_updated_at();

create or replace function public.myspaces_capture_space_sync_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  row_user_id uuid;
  row_space_id uuid;
  row_snapshot jsonb;
  row_deleted boolean;
begin
  if tg_op = 'DELETE' then
    row_user_id := old.user_id;
    row_space_id := old.id;
    row_snapshot := null;
    row_deleted := true;
  else
    row_user_id := new.user_id;
    row_space_id := new.id;
    row_snapshot := to_jsonb(new);
    row_deleted := false;
  end if;

  insert into public.space_sync_state (user_id, space_id, revision, deleted, snapshot, updated_at)
  values (row_user_id, row_space_id, 1, row_deleted, row_snapshot, clock_timestamp())
  on conflict (user_id, space_id) do update set
    revision = public.space_sync_state.revision + 1,
    deleted = excluded.deleted,
    snapshot = excluded.snapshot,
    updated_at = clock_timestamp();

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists myspaces_capture_space_sync_state on public.spaces;
create trigger myspaces_capture_space_sync_state
  after insert or update or delete on public.spaces
  for each row execute function public.myspaces_capture_space_sync_state();

-- Backfill current Spaces so new clients have a complete initial snapshot.
insert into public.space_sync_state (user_id, space_id, revision, deleted, snapshot, updated_at)
select user_id, id, 1, false, to_jsonb(spaces), coalesce(updated_at, clock_timestamp())
from public.spaces
on conflict (user_id, space_id) do nothing;

-- The sync-state table contains updates rather than hard deletes, so clients can
-- receive deletion markers through Postgres Changes and recover after being offline.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'space_sync_state'
     ) then
    alter publication supabase_realtime add table public.space_sync_state;
  end if;
end;
$$;

-- Compare-and-apply makes simultaneous writes retry against the latest revision
-- instead of silently replacing another device's tab additions.
create or replace function public.myspaces_apply_space_change(
  p_space_id uuid,
  p_expected_revision bigint,
  p_deleted boolean,
  p_name text default null,
  p_tabs jsonb default null,
  p_created_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  current_state public.space_sync_state%rowtype;
  current_revision bigint := 0;
begin
  if actor_id is null then
    raise exception 'Authentication required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(actor_id::text || ':' || p_space_id::text, 0));
  select * into current_state
  from public.space_sync_state
  where user_id = actor_id and space_id = p_space_id
  for update;

  if found then current_revision := current_state.revision; end if;
  if current_revision <> coalesce(p_expected_revision, 0) then
    return jsonb_build_object(
      'applied', false,
      'revision', current_revision,
      'deleted', coalesce(current_state.deleted, false),
      'snapshot', current_state.snapshot,
      'updated_at', current_state.updated_at
    );
  end if;

  if p_deleted then
    delete from public.spaces where id = p_space_id and user_id = actor_id;
    if not found then
      insert into public.space_sync_state (user_id, space_id, revision, deleted, snapshot, updated_at)
      values (actor_id, p_space_id, current_revision + 1, true, null, clock_timestamp())
      on conflict (user_id, space_id) do update set
        revision = public.space_sync_state.revision + 1,
        deleted = true,
        snapshot = null,
        updated_at = clock_timestamp();
    end if;
  else
    if p_name is null or p_tabs is null then
      raise exception 'A Space name and tab snapshot are required';
    end if;
    insert into public.spaces (id, user_id, name, tabs, created_at, updated_at)
    values (
      p_space_id,
      actor_id,
      p_name,
      p_tabs,
      coalesce(p_created_at, clock_timestamp()),
      clock_timestamp()
    )
    on conflict (id) do update set
      name = excluded.name,
      tabs = excluded.tabs,
      updated_at = clock_timestamp()
    where public.spaces.user_id = actor_id;
  end if;

  select * into current_state
  from public.space_sync_state
  where user_id = actor_id and space_id = p_space_id;
  if not found then
    raise exception 'Space sync state was not recorded';
  end if;
  return jsonb_build_object(
    'applied', true,
    'revision', current_state.revision,
    'deleted', current_state.deleted,
    'snapshot', current_state.snapshot,
    'updated_at', current_state.updated_at
  );
end;
$$;

revoke all on function public.myspaces_apply_space_change(uuid, bigint, boolean, text, jsonb, timestamptz) from public, anon;
grant execute on function public.myspaces_apply_space_change(uuid, bigint, boolean, text, jsonb, timestamptz) to authenticated;

notify pgrst, 'reload schema';
