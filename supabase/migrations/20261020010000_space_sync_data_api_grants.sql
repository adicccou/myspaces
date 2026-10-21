-- Keep private tab snapshots accessible only to signed-in owners through the
-- Data API. The client reads snapshots and writes through the authenticated
-- compare-and-apply RPC; direct table writes are not required.

grant usage on schema public to authenticated;

revoke all on table public.space_sync_state from anon, authenticated;
grant select on table public.space_sync_state to authenticated;
