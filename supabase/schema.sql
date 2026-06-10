create table if not exists public.count_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.count_events enable row level security;

drop policy if exists "Users can read their own counts" on public.count_events;
create policy "Users can read their own counts"
on public.count_events
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own counts" on public.count_events;
create policy "Users can insert their own counts"
on public.count_events
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own counts" on public.count_events;
create policy "Users can delete their own counts"
on public.count_events
for delete
to authenticated
using (auth.uid() = user_id);

create index if not exists count_events_user_observed_at_idx
on public.count_events (user_id, observed_at desc);
