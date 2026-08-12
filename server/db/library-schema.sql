-- Mystery Commons additive migration for the existing YZ_json Supabase project.
-- Prerequisite: public.users from YZ_json/server/db/schema-supabase.sql.

begin;

create table if not exists public.library_books (
  id text primary key,
  source text not null check (source in ('Standard Ebooks', 'Project Gutenberg')),
  source_id text not null,
  title_original text not null,
  title_zh text not null,
  author text not null,
  author_death_year integer,
  description_zh text not null,
  category text not null,
  subcategory text not null,
  language text not null default 'en',
  edition_release_date date,
  subjects jsonb not null default '[]'::jsonb,
  source_url text not null,
  epub_url text not null,
  cover_url text,
  sha256 text not null,
  file_size bigint not null check (file_size > 0),
  license_status text not null,
  local_copyright_check text not null,
  rights_status text not null default 'reviewed' check (rights_status in ('reviewed', 'hold', 'removed')),
  catalog_order integer not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, source_id),
  unique (sha256)
);

create table if not exists public.book_readers (
  book_id text not null references public.library_books(id) on delete cascade,
  reader_key text not null,
  user_id text references public.users(id) on delete set null,
  first_opened_at timestamptz not null default now(),
  last_opened_at timestamptz not null default now(),
  open_count integer not null default 1 check (open_count > 0),
  primary key (book_id, reader_key)
);

create table if not exists public.book_ratings (
  book_id text not null references public.library_books(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (book_id, user_id)
);

create table if not exists public.book_favorites (
  book_id text not null references public.library_books(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (book_id, user_id)
);

create table if not exists public.book_progress (
  book_id text not null references public.library_books(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  cfi text not null,
  chapter_href text,
  percentage numeric(6,3) not null default 0 check (percentage between 0 and 100),
  updated_at timestamptz not null default now(),
  primary key (book_id, user_id)
);

create table if not exists public.book_annotations (
  id text primary key,
  book_id text not null references public.library_books(id) on delete cascade,
  author_id text not null references public.users(id) on delete cascade,
  chapter_href text,
  cfi_range text not null,
  quote text,
  content text not null check (char_length(content) between 1 and 2000),
  visibility text not null default 'public' check (visibility in ('private', 'public')),
  status text not null default 'active' check (status in ('active', 'hidden', 'deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.book_annotation_votes (
  annotation_id text not null references public.book_annotations(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  vote_type text not null check (vote_type in ('up', 'down')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (annotation_id, user_id)
);

create table if not exists public.book_annotation_replies (
  id text primary key,
  annotation_id text not null references public.book_annotations(id) on delete cascade,
  parent_reply_id text references public.book_annotation_replies(id) on delete cascade,
  author_id text not null references public.users(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 2000),
  status text not null default 'active' check (status in ('active', 'hidden', 'deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.library_feedback (
  id text primary key,
  parent_id text references public.library_feedback(id) on delete cascade,
  author_id text not null references public.users(id) on delete cascade,
  book_id text references public.library_books(id) on delete set null,
  subject text,
  content text not null check (char_length(content) between 1 and 2000),
  status text not null default 'active' check (status in ('active', 'resolved', 'hidden', 'deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_library_books_category on public.library_books(category, enabled, catalog_order);
create index if not exists idx_book_readers_book on public.book_readers(book_id);
create index if not exists idx_book_ratings_book on public.book_ratings(book_id);
create index if not exists idx_book_favorites_user on public.book_favorites(user_id, created_at desc);
create index if not exists idx_book_progress_user on public.book_progress(user_id, updated_at desc);
create index if not exists idx_book_annotations_render on public.book_annotations(book_id, chapter_href, created_at) where status = 'active';
create index if not exists idx_book_annotation_replies_annotation on public.book_annotation_replies(annotation_id, created_at) where status = 'active';
create index if not exists idx_library_feedback_thread on public.library_feedback(parent_id, created_at) where status = 'active';

drop view if exists public.book_public_metrics;
drop function if exists public.record_book_open(text, text, text);

-- Creates or refreshes only the caller's own public.users row. Identity comes
-- from the verified Supabase JWT; callers cannot select another user id or role.
create or replace function public.ensure_library_profile()
returns table (
  id text,
  email text,
  display_name text,
  public_display_name text,
  avatar_url text,
  role text,
  is_active boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid text := auth.uid()::text;
  v_metadata jsonb := coalesce(auth.jwt() -> 'user_metadata', '{}'::jsonb);
  v_email text := auth.jwt() ->> 'email';
  v_name text;
  v_google_sub text;
  v_avatar text;
begin
  if v_uid is null or v_email is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  v_name := left(coalesce(nullif(v_metadata ->> 'full_name', ''), nullif(v_metadata ->> 'name', ''), split_part(v_email, '@', 1), '讀者'), 80);
  v_google_sub := v_uid;
  v_avatar := coalesce(nullif(v_metadata ->> 'avatar_url', ''), nullif(v_metadata ->> 'picture', ''));

  insert into public.users as existing(id, google_sub, email, display_name, public_display_name, avatar_url, last_login_at, is_active, updated_at)
  values (v_uid, v_google_sub, v_email, v_name, v_name, v_avatar, now(), true, now())
  on conflict on constraint users_pkey do update
    set email = excluded.email,
        avatar_url = coalesce(excluded.avatar_url, existing.avatar_url),
        last_login_at = now(),
        updated_at = now();

  return query
  select u.id, u.email, u.display_name, u.public_display_name, u.avatar_url, u.role, u.is_active
  from public.users u
  where u.id = v_uid and u.is_active = true and u.deleted_at is null;
end;
$$;

create or replace function public.library_user_is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.users u
    where u.id = auth.uid()::text and u.is_active = true and u.deleted_at is null
  );
$$;

-- Safe projection for names shown beside public annotations and feedback.
create or replace function public.get_library_public_profiles(p_user_ids text[])
returns table (id text, public_display_name text, avatar_url text, role text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(cardinality(p_user_ids), 0) > 500 then
    raise exception 'TOO_MANY_PROFILE_IDS';
  end if;
  return query
  select u.id, u.public_display_name, u.avatar_url, u.role
  from public.users u
  where u.id = any(coalesce(p_user_ids, array[]::text[]))
    and u.is_active = true
    and u.deleted_at is null;
end;
$$;

-- Aggregate-only public metrics; reader keys and user ids are never returned.
create or replace function public.get_book_public_metrics(p_book_ids text[])
returns table (
  book_id text,
  reader_count bigint,
  rating_count bigint,
  average_rating numeric,
  favorite_count bigint,
  annotation_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(cardinality(p_book_ids), 0) > 200 then
    raise exception 'TOO_MANY_BOOK_IDS';
  end if;
  return query
  select b.id,
         (select count(*) from public.book_readers r where r.book_id = b.id),
         (select count(*) from public.book_ratings rt where rt.book_id = b.id),
         coalesce((select avg(rt.rating) from public.book_ratings rt where rt.book_id = b.id), 0)::numeric,
         (select count(*) from public.book_favorites f where f.book_id = b.id),
         (select count(*) from public.book_annotations a where a.book_id = b.id and a.status = 'active' and a.visibility = 'public')
  from public.library_books b
  where b.id = any(coalesce(p_book_ids, array[]::text[]))
    and b.enabled = true
    and b.rights_status = 'reviewed';
end;
$$;

-- Returns vote totals plus only the current caller's vote, never other voters.
create or replace function public.get_library_annotation_vote_stats(p_annotation_ids text[])
returns table (annotation_id text, score bigint, viewer_vote text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(cardinality(p_annotation_ids), 0) > 500 then
    raise exception 'TOO_MANY_ANNOTATION_IDS';
  end if;
  return query
  select a.id,
         coalesce(sum(case when v.vote_type = 'up' then 1 when v.vote_type = 'down' then -1 else 0 end), 0)::bigint,
         max(v.vote_type) filter (where v.user_id = auth.uid()::text)
  from public.book_annotations a
  left join public.book_annotation_votes v on v.annotation_id = a.id
  where a.id = any(coalesce(p_annotation_ids, array[]::text[]))
    and a.status = 'active'
    and (a.visibility = 'public' or a.author_id = auth.uid()::text)
  group by a.id;
end;
$$;

create or replace function public.record_book_open(p_book_id text, p_reader_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id text := auth.uid()::text;
  v_reader_key text;
begin
  if not exists (select 1 from public.library_books where id = p_book_id and enabled = true and rights_status = 'reviewed') then
    raise exception 'BOOK_NOT_AVAILABLE';
  end if;
  if v_user_id is not null then
    v_reader_key := 'user:' || v_user_id;
  elsif p_reader_key ~ '^anon:[a-f0-9]{64}$' then
    v_reader_key := p_reader_key;
  else
    raise exception 'INVALID_READER_KEY';
  end if;
  insert into public.book_readers(book_id, reader_key, user_id)
  values (p_book_id, v_reader_key, v_user_id)
  on conflict (book_id, reader_key) do update
    set last_opened_at = now(),
        open_count = public.book_readers.open_count + 1,
        user_id = coalesce(excluded.user_id, public.book_readers.user_id);
end;
$$;

alter table public.library_books enable row level security;
alter table public.book_readers enable row level security;
alter table public.book_ratings enable row level security;
alter table public.book_favorites enable row level security;
alter table public.book_progress enable row level security;
alter table public.book_annotations enable row level security;
alter table public.book_annotation_votes enable row level security;
alter table public.book_annotation_replies enable row level security;
alter table public.library_feedback enable row level security;

revoke all on public.library_books, public.book_readers, public.book_ratings, public.book_favorites,
  public.book_progress, public.book_annotations, public.book_annotation_votes,
  public.book_annotation_replies, public.library_feedback from anon, authenticated;

drop policy if exists library_books_public_read on public.library_books;
create policy library_books_public_read on public.library_books for select to anon, authenticated
  using (enabled = true and rights_status = 'reviewed');

drop policy if exists book_ratings_own_read on public.book_ratings;
drop policy if exists book_ratings_own_insert on public.book_ratings;
drop policy if exists book_ratings_own_update on public.book_ratings;
drop policy if exists book_ratings_own_delete on public.book_ratings;
create policy book_ratings_own_read on public.book_ratings for select to authenticated using (user_id = auth.uid()::text and public.library_user_is_active());
create policy book_ratings_own_insert on public.book_ratings for insert to authenticated with check (user_id = auth.uid()::text and public.library_user_is_active());
create policy book_ratings_own_update on public.book_ratings for update to authenticated using (user_id = auth.uid()::text and public.library_user_is_active()) with check (user_id = auth.uid()::text and public.library_user_is_active());
create policy book_ratings_own_delete on public.book_ratings for delete to authenticated using (user_id = auth.uid()::text and public.library_user_is_active());

drop policy if exists book_favorites_own_read on public.book_favorites;
drop policy if exists book_favorites_own_insert on public.book_favorites;
drop policy if exists book_favorites_own_delete on public.book_favorites;
create policy book_favorites_own_read on public.book_favorites for select to authenticated using (user_id = auth.uid()::text and public.library_user_is_active());
create policy book_favorites_own_insert on public.book_favorites for insert to authenticated with check (user_id = auth.uid()::text and public.library_user_is_active());
create policy book_favorites_own_delete on public.book_favorites for delete to authenticated using (user_id = auth.uid()::text and public.library_user_is_active());

drop policy if exists book_progress_own_read on public.book_progress;
drop policy if exists book_progress_own_insert on public.book_progress;
drop policy if exists book_progress_own_update on public.book_progress;
create policy book_progress_own_read on public.book_progress for select to authenticated using (user_id = auth.uid()::text and public.library_user_is_active());
create policy book_progress_own_insert on public.book_progress for insert to authenticated with check (user_id = auth.uid()::text and public.library_user_is_active());
create policy book_progress_own_update on public.book_progress for update to authenticated using (user_id = auth.uid()::text and public.library_user_is_active()) with check (user_id = auth.uid()::text and public.library_user_is_active());

drop policy if exists book_annotations_visible_read on public.book_annotations;
drop policy if exists book_annotations_own_insert on public.book_annotations;
create policy book_annotations_visible_read on public.book_annotations for select to anon, authenticated
  using (status = 'active' and (visibility = 'public' or (author_id = auth.uid()::text and public.library_user_is_active())));
create policy book_annotations_own_insert on public.book_annotations for insert to authenticated
  with check (
    author_id = auth.uid()::text and status = 'active' and public.library_user_is_active()
    and exists (select 1 from public.library_books b where b.id = book_annotations.book_id and b.enabled = true and b.rights_status = 'reviewed')
  );

drop policy if exists book_annotation_votes_own_insert on public.book_annotation_votes;
drop policy if exists book_annotation_votes_own_update on public.book_annotation_votes;
drop policy if exists book_annotation_votes_own_delete on public.book_annotation_votes;
create policy book_annotation_votes_own_insert on public.book_annotation_votes for insert to authenticated
  with check (user_id = auth.uid()::text and public.library_user_is_active() and exists (
    select 1 from public.book_annotations a where a.id = book_annotation_votes.annotation_id and a.status = 'active'
      and (a.visibility = 'public' or a.author_id = auth.uid()::text)
  ));
create policy book_annotation_votes_own_update on public.book_annotation_votes for update to authenticated
  using (user_id = auth.uid()::text and public.library_user_is_active()) with check (user_id = auth.uid()::text and public.library_user_is_active());
create policy book_annotation_votes_own_delete on public.book_annotation_votes for delete to authenticated using (user_id = auth.uid()::text and public.library_user_is_active());

drop policy if exists book_annotation_replies_visible_read on public.book_annotation_replies;
drop policy if exists book_annotation_replies_own_insert on public.book_annotation_replies;
create policy book_annotation_replies_visible_read on public.book_annotation_replies for select to anon, authenticated
  using (status = 'active' and exists (
    select 1 from public.book_annotations a where a.id = book_annotation_replies.annotation_id and a.status = 'active'
      and (a.visibility = 'public' or (a.author_id = auth.uid()::text and public.library_user_is_active()))
  ));
create policy book_annotation_replies_own_insert on public.book_annotation_replies for insert to authenticated
  with check (
    author_id = auth.uid()::text and status = 'active' and public.library_user_is_active()
    and exists (select 1 from public.book_annotations a where a.id = book_annotation_replies.annotation_id and a.status = 'active'
      and (a.visibility = 'public' or a.author_id = auth.uid()::text))
    and parent_reply_id is null
  );

drop policy if exists library_feedback_public_read on public.library_feedback;
drop policy if exists library_feedback_own_insert on public.library_feedback;
create policy library_feedback_public_read on public.library_feedback for select to anon, authenticated using (status = 'active');
create policy library_feedback_own_insert on public.library_feedback for insert to authenticated
  with check (author_id = auth.uid()::text and status = 'active' and public.library_user_is_active());

grant select on public.library_books to anon, authenticated;
grant select, delete on public.book_ratings to authenticated;
grant insert (book_id, user_id, rating, updated_at) on public.book_ratings to authenticated;
grant update (rating, updated_at) on public.book_ratings to authenticated;
grant select, delete on public.book_favorites to authenticated;
grant insert (book_id, user_id) on public.book_favorites to authenticated;
grant select on public.book_progress to authenticated;
grant insert (book_id, user_id, cfi, chapter_href, percentage, updated_at) on public.book_progress to authenticated;
grant update (cfi, chapter_href, percentage, updated_at) on public.book_progress to authenticated;
grant select on public.book_annotations to anon, authenticated;
grant insert (id, book_id, author_id, chapter_href, cfi_range, quote, content, visibility) on public.book_annotations to authenticated;
grant delete on public.book_annotation_votes to authenticated;
grant insert (annotation_id, user_id, vote_type, updated_at) on public.book_annotation_votes to authenticated;
grant update (vote_type, updated_at) on public.book_annotation_votes to authenticated;
grant select on public.book_annotation_replies to anon, authenticated;
grant insert (id, annotation_id, author_id, content) on public.book_annotation_replies to authenticated;
grant select on public.library_feedback to anon, authenticated;
grant insert (id, parent_id, author_id, book_id, subject, content) on public.library_feedback to authenticated;

revoke all on function public.ensure_library_profile() from public, anon, authenticated;
revoke all on function public.library_user_is_active() from public, anon, authenticated;
revoke all on function public.get_library_public_profiles(text[]) from public, anon, authenticated;
revoke all on function public.get_book_public_metrics(text[]) from public, anon, authenticated;
revoke all on function public.get_library_annotation_vote_stats(text[]) from public, anon, authenticated;
revoke all on function public.record_book_open(text, text) from public, anon, authenticated;
grant execute on function public.ensure_library_profile() to authenticated;
grant execute on function public.library_user_is_active() to authenticated;
grant execute on function public.get_library_public_profiles(text[]) to anon, authenticated;
grant execute on function public.get_book_public_metrics(text[]) to anon, authenticated;
grant execute on function public.get_library_annotation_vote_stats(text[]) to anon, authenticated;
grant execute on function public.record_book_open(text, text) to anon, authenticated;

commit;
