-- Add optional Space icon styling without changing or recreating user data.
alter table public.spaces
  add column if not exists icon text,
  add column if not exists icon_color text;

-- Refresh durable snapshots so new clients see the added nullable fields.
update public.space_sync_state as sync_state
set snapshot = to_jsonb(spaces),
    revision = sync_state.revision + 1,
    updated_at = clock_timestamp()
from public.spaces as spaces
where sync_state.user_id = spaces.user_id
  and sync_state.space_id = spaces.id
  and not sync_state.deleted;

-- Versioned RPC avoids changing the signature expected by already-released clients.
create or replace function public.myspaces_apply_space_change_v3(
  p_space_id uuid,
  p_expected_revision bigint,
  p_deleted boolean,
  p_name text default null,
  p_tabs jsonb default null,
  p_created_at timestamptz default null,
  p_sort_order integer default null,
  p_icon text default null,
  p_icon_color text default null
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
    insert into public.spaces (id, user_id, name, tabs, created_at, updated_at, sort_order, icon, icon_color)
    values (
      p_space_id,
      actor_id,
      p_name,
      p_tabs,
      coalesce(p_created_at, clock_timestamp()),
      clock_timestamp(),
      coalesce(p_sort_order, 0),
      p_icon,
      p_icon_color
    )
    on conflict (id) do update set
      name = excluded.name,
      tabs = excluded.tabs,
      sort_order = excluded.sort_order,
      icon = excluded.icon,
      icon_color = excluded.icon_color,
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

revoke all on function public.myspaces_apply_space_change_v3(uuid, bigint, boolean, text, jsonb, timestamptz, integer, text, text) from public, anon;
grant execute on function public.myspaces_apply_space_change_v3(uuid, bigint, boolean, text, jsonb, timestamptz, integer, text, text) to authenticated;

notify pgrst, 'reload schema';
