# MySpaces

MySpaces saves tab collections locally and synchronizes them across signed-in devices through Supabase.

The main interface opens in the browser side panel. It keeps the existing Space controls and account data while leaving the panel available as tabs are opened and switched.

## Reliable synchronization

The extension keeps local edits in a persistent outbox until Supabase confirms them. It merges concurrent server changes, stores deletion markers so disconnected devices learn about removals, listens for Supabase Realtime changes, and retries failed requests with backoff. Tab changes are captured after a short quiet period, and the current Space is captured before a Space switch. Tab IDs, pinned state, group metadata, tab order, and Space order are preserved across snapshots. Remote snapshots update saved Spaces without rearranging tabs in a window the user is currently working in; selecting a Space restores its latest saved snapshot.

The database changes are additive. They keep the existing `spaces` table and add `space_sync_state`, which records the latest snapshot or deletion marker for each Space, plus a `sort_order` column so dragged Space layouts sync across devices. Existing local account, license, and Space data stays in the same `app-storage` key. Shared writes are serialized and merge independent fields so background tab captures and side-panel edits do not overwrite each other.

### Deploying the database migration

Apply all migrations in `supabase/migrations/` to the Supabase project before publishing the extension update. For example, from a linked Supabase CLI project, run:

```sh
supabase db push
```

The migrations preserve existing Space IDs and tab data. They backfill sync snapshots and Space order, add triggers for later changes, and add compare-and-apply RPCs. The extension retains a compatibility fallback for installations that have not applied the migrations. That fallback is labeled **Auto sync** and does not provide conflict-safe writes, durable deletion propagation, synchronized Space ordering, or immediate realtime updates.

## Development

```sh
pnpm install
pnpm dev
```

Build the Chrome extension with `pnpm build`.
