-- Mystery Commons schema. It can initialize a fresh Supabase project and also
-- remains additive when public.users already exists in a shared YZ_json project.

begin;

create table if not exists public.users (
  id text primary key,
  google_sub text not null unique,
  email text not null unique,
  display_name text not null,
  public_display_name text not null,
  avatar_url text,
  role text not null default 'user' check (role in ('user', 'moderator', 'admin')),
  last_login_at timestamptz,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create table if not exists public.book_reviews (
  id text primary key,
  book_id text not null references public.library_books(id) on delete cascade,
  author_id text not null references public.users(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 4000),
  status text not null default 'active' check (status in ('active', 'hidden', 'deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (book_id, author_id)
);

create table if not exists public.book_review_likes (
  review_id text not null references public.book_reviews(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (review_id, user_id)
);

create table if not exists public.book_review_favorites (
  review_id text not null references public.book_reviews(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (review_id, user_id)
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
  anchor_offset_start integer,
  anchor_offset_end integer,
  cluster_key integer,
  quote text,
  content text not null check (char_length(content) between 1 and 2000),
  visibility text not null default 'public' check (visibility in ('private', 'public')),
  status text not null default 'active' check (status in ('active', 'hidden', 'deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.book_annotations
  add column if not exists anchor_offset_start integer,
  add column if not exists anchor_offset_end integer,
  add column if not exists cluster_key integer;

alter table public.book_annotations drop constraint if exists book_annotations_anchor_offsets_check;
alter table public.book_annotations add constraint book_annotations_anchor_offsets_check check (
  (anchor_offset_start is null and anchor_offset_end is null and cluster_key is null)
  or (
    anchor_offset_start >= 0
    and anchor_offset_end >= anchor_offset_start
    and cluster_key = floor(anchor_offset_start / 5.0)::integer
  )
);

create table if not exists public.book_annotation_votes (
  annotation_id text not null references public.book_annotations(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  vote_type text not null check (vote_type in ('up', 'down')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (annotation_id, user_id)
);

create table if not exists public.book_annotation_favorites (
  annotation_id text not null references public.book_annotations(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
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

create table if not exists public.book_annotation_reply_votes (
  reply_id text not null references public.book_annotation_replies(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  vote_type text not null check (vote_type in ('up', 'down')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (reply_id, user_id)
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

create table if not exists public.library_feedback_votes (
  feedback_id text not null references public.library_feedback(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  vote_type text not null check (vote_type in ('up', 'down')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (feedback_id, user_id)
);

create table if not exists public.library_user_settings (
  user_id text primary key references public.users(id) on delete cascade,
  notify_annotation_replies boolean not null default true,
  notify_annotation_likes boolean not null default true,
  notify_annotation_favorites boolean not null default true,
  notify_review_likes boolean not null default true,
  notify_feedback_replies boolean not null default true,
  annotation_visibility_threshold smallint not null default 50 check (annotation_visibility_threshold between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.library_user_settings
  add column if not exists annotation_visibility_threshold smallint not null default 50
  check (annotation_visibility_threshold between 0 and 100);

create table if not exists public.library_notifications (
  id bigint generated always as identity primary key,
  user_id text not null references public.users(id) on delete cascade,
  actor_id text references public.users(id) on delete set null,
  type text not null check (type in ('annotation_reply', 'annotation_reply_like', 'annotation_like', 'annotation_favorite', 'review_like', 'review_favorite', 'feedback_reply', 'system')),
  book_id text references public.library_books(id) on delete cascade,
  target_type text not null check (target_type in ('annotation', 'review', 'feedback', 'system')),
  target_id text,
  message text not null check (char_length(message) between 1 and 500),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, type, actor_id, target_type, target_id)
);

alter table public.library_notifications drop constraint if exists library_notifications_type_check;
alter table public.library_notifications add constraint library_notifications_type_check
  check (type in ('annotation_reply', 'annotation_reply_like', 'annotation_like', 'annotation_favorite', 'review_like', 'review_favorite', 'feedback_reply', 'system'));

-- Small append-only deltas make reconnect catch-up deterministic without
-- exposing full rows over Realtime. Old entries are pruned opportunistically.
create table if not exists public.library_realtime_events (
  sequence_id bigint generated always as identity primary key,
  topic text not null,
  resource text not null check (resource in ('notification', 'book_rating', 'book_favorite', 'review', 'review_like', 'review_favorite', 'annotation', 'annotation_reply', 'annotation_reply_vote', 'annotation_vote', 'annotation_favorite', 'feedback', 'feedback_vote')),
  operation text not null check (operation in ('insert', 'update', 'delete')),
  target_id text,
  book_id text references public.library_books(id) on delete cascade,
  user_id text references public.users(id) on delete cascade,
  emitted_at timestamptz not null default now(),
  check (
    (book_id is not null and user_id is null and topic in ('book:' || book_id || ':activity', 'catalog:activity'))
    or (book_id is null and user_id is null and topic = 'feedback:activity')
    or (user_id is not null and book_id is null and topic = 'user:' || user_id || ':notifications')
  )
);

alter table public.library_realtime_events drop constraint if exists library_realtime_events_resource_check;
alter table public.library_realtime_events add constraint library_realtime_events_resource_check
  check (resource in ('notification', 'book_rating', 'book_favorite', 'review', 'review_like', 'review_favorite', 'annotation', 'annotation_reply', 'annotation_reply_vote', 'annotation_vote', 'annotation_favorite', 'feedback', 'feedback_vote'));
alter table public.library_realtime_events drop constraint if exists library_realtime_events_check;
alter table public.library_realtime_events drop constraint if exists library_realtime_events_topic_check;
alter table public.library_realtime_events add constraint library_realtime_events_topic_check
  check (
    (book_id is not null and user_id is null and topic in ('book:' || book_id || ':activity', 'catalog:activity'))
    or (book_id is null and user_id is null and topic = 'feedback:activity')
    or (user_id is not null and book_id is null and topic = 'user:' || user_id || ':notifications')
  );

create index if not exists idx_library_books_category on public.library_books(category, enabled, catalog_order);
create index if not exists idx_book_readers_book on public.book_readers(book_id);
create index if not exists idx_book_ratings_book on public.book_ratings(book_id);
create index if not exists idx_book_favorites_user on public.book_favorites(user_id, created_at desc);
create index if not exists idx_book_reviews_book on public.book_reviews(book_id, created_at desc) where status = 'active';
create index if not exists idx_book_reviews_author on public.book_reviews(author_id, updated_at desc) where status = 'active';
create index if not exists idx_book_review_favorites_review on public.book_review_favorites(review_id);
create index if not exists idx_book_progress_user on public.book_progress(user_id, updated_at desc);
create index if not exists idx_book_annotations_render on public.book_annotations(book_id, chapter_href, created_at) where status = 'active';
create index if not exists idx_book_annotations_cluster on public.book_annotations(book_id, chapter_href, visibility, cluster_key, created_at) where status = 'active';
create index if not exists idx_book_annotation_favorites_user on public.book_annotation_favorites(user_id, created_at desc);
create index if not exists idx_book_annotation_replies_annotation on public.book_annotation_replies(annotation_id, created_at) where status = 'active';
create index if not exists idx_book_annotation_reply_votes_reply on public.book_annotation_reply_votes(reply_id);
create index if not exists idx_library_feedback_thread on public.library_feedback(parent_id, created_at) where status = 'active';
create index if not exists idx_library_feedback_votes_feedback on public.library_feedback_votes(feedback_id);
create index if not exists idx_library_notifications_user on public.library_notifications(user_id, read_at, created_at desc);
create index if not exists idx_library_realtime_events_topic on public.library_realtime_events(topic, sequence_id);
create index if not exists idx_library_realtime_events_expiry on public.library_realtime_events(emitted_at);

drop view if exists public.book_public_metrics;
drop function if exists public.record_book_open(text, text, text);
drop function if exists public.get_book_public_metrics(text[]);

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

  insert into public.library_user_settings(user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  return query
  select u.id, u.email, u.display_name, u.public_display_name, u.avatar_url, u.role, u.is_active
  from public.users u
  where u.id = v_uid and u.is_active = true and u.deleted_at is null;
end;
$$;

create or replace function public.update_library_profile(p_public_display_name text)
returns table (id text, email text, display_name text, public_display_name text, avatar_url text, role text, is_active boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid text := auth.uid()::text;
  v_name text := left(regexp_replace(trim(coalesce(p_public_display_name, '')), '\s+', ' ', 'g'), 80);
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if char_length(v_name) < 2 then
    raise exception 'INVALID_DISPLAY_NAME';
  end if;
  update public.users u
  set public_display_name = v_name, updated_at = now()
  where u.id = v_uid and u.is_active = true and u.deleted_at is null;
  return query
  select u.id, u.email, u.display_name, u.public_display_name, u.avatar_url, u.role, u.is_active
  from public.users u where u.id = v_uid;
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
  annotation_count bigint,
  review_count bigint
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
         (select count(*) from public.book_annotations a where a.book_id = b.id and a.status = 'active' and a.visibility = 'public'),
         (select count(*) from public.book_reviews rv where rv.book_id = b.id and rv.status = 'active')
  from public.library_books b
  where b.id = any(coalesce(p_book_ids, array[]::text[]))
    and b.enabled = true
    and b.rights_status = 'reviewed';
end;
$$;

-- One atomic rating entry point keeps the caller's stars and the public
-- aggregate in sync without depending on browser-side table upsert details.
create or replace function public.set_library_book_rating(p_book_id text, p_rating integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid text := auth.uid()::text;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if not public.library_user_is_active() then
    raise exception 'USER_INACTIVE' using errcode = '42501';
  end if;
  if p_rating is null or p_rating < 0 or p_rating > 5 then
    raise exception 'INVALID_RATING';
  end if;
  if not exists (
    select 1 from public.library_books b
    where b.id = p_book_id and b.enabled = true and b.rights_status = 'reviewed'
  ) then
    raise exception 'BOOK_NOT_AVAILABLE';
  end if;

  if p_rating = 0 then
    delete from public.book_ratings r
    where r.book_id = p_book_id and r.user_id = v_uid;
  else
    insert into public.book_ratings as current_rating(book_id, user_id, rating, updated_at)
    values (p_book_id, v_uid, p_rating::smallint, now())
    on conflict on constraint book_ratings_pkey do update
      set rating = excluded.rating,
          updated_at = now();
  end if;
end;
$$;

drop function if exists public.get_library_review_like_stats(text[]);
create function public.get_library_review_like_stats(p_review_ids text[])
returns table (review_id text, like_count bigint, viewer_liked boolean, favorite_count bigint, viewer_favorite boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(cardinality(p_review_ids), 0) > 500 then
    raise exception 'TOO_MANY_REVIEW_IDS';
  end if;
  return query
  select r.id,
         count(distinct l.user_id)::bigint,
         coalesce(bool_or(l.user_id = auth.uid()::text), false),
         count(distinct f.user_id)::bigint,
         coalesce(bool_or(f.user_id = auth.uid()::text), false)
  from public.book_reviews r
  left join public.book_review_likes l on l.review_id = r.id
  left join public.book_review_favorites f on f.review_id = r.id
  where r.id = any(coalesce(p_review_ids, array[]::text[])) and r.status = 'active'
  group by r.id;
end;
$$;

create or replace function public.get_library_annotation_favorite_stats(p_annotation_ids text[])
returns table (annotation_id text, favorite_count bigint, viewer_favorite boolean)
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
         count(f.user_id)::bigint,
         coalesce(bool_or(f.user_id = auth.uid()::text), false)
  from public.book_annotations a
  left join public.book_annotation_favorites f on f.annotation_id = a.id
  where a.id = any(coalesce(p_annotation_ids, array[]::text[]))
    and a.status = 'active'
    and (a.visibility = 'public' or a.author_id = auth.uid()::text)
  group by a.id;
end;
$$;

-- Returns rank inputs plus only the current caller's vote, never other voters.
drop function if exists public.get_library_annotation_vote_stats(text[]);
create function public.get_library_annotation_vote_stats(p_annotation_ids text[])
returns table (annotation_id text, score bigint, up_count bigint, down_count bigint, viewer_vote text)
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
         count(*) filter (where v.vote_type = 'up')::bigint,
         count(*) filter (where v.vote_type = 'down')::bigint,
         max(v.vote_type) filter (where v.user_id = auth.uid()::text)
  from public.book_annotations a
  left join public.book_annotation_votes v on v.annotation_id = a.id
  where a.id = any(coalesce(p_annotation_ids, array[]::text[]))
    and a.status = 'active'
    and (a.visibility = 'public' or a.author_id = auth.uid()::text)
  group by a.id;
end;
$$;

drop function if exists public.get_library_annotation_reply_vote_stats(text[]);
create function public.get_library_annotation_reply_vote_stats(p_reply_ids text[])
returns table (reply_id text, score bigint, up_count bigint, down_count bigint, viewer_vote text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(cardinality(p_reply_ids), 0) > 1000 then
    raise exception 'TOO_MANY_REPLY_IDS';
  end if;
  return query
  select r.id,
         coalesce(sum(case when v.vote_type = 'up' then 1 when v.vote_type = 'down' then -1 else 0 end), 0)::bigint,
         count(*) filter (where v.vote_type = 'up')::bigint,
         count(*) filter (where v.vote_type = 'down')::bigint,
         max(v.vote_type) filter (where v.user_id = auth.uid()::text)
  from public.book_annotation_replies r
  join public.book_annotations a on a.id = r.annotation_id
  left join public.book_annotation_reply_votes v on v.reply_id = r.id
  where r.id = any(coalesce(p_reply_ids, array[]::text[]))
    and r.status = 'active'
    and a.status = 'active'
    and (a.visibility = 'public' or a.author_id = auth.uid()::text)
  group by r.id;
end;
$$;

create or replace function public.get_library_feedback_vote_stats(p_feedback_ids text[])
returns table (feedback_id text, score bigint, up_count bigint, down_count bigint, viewer_vote text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(cardinality(p_feedback_ids), 0) > 500 then
    raise exception 'TOO_MANY_FEEDBACK_IDS';
  end if;
  return query
  select f.id,
         coalesce(sum(case when v.vote_type = 'up' then 1 when v.vote_type = 'down' then -1 else 0 end), 0)::bigint,
         count(*) filter (where v.vote_type = 'up')::bigint,
         count(*) filter (where v.vote_type = 'down')::bigint,
         max(v.vote_type) filter (where v.user_id = auth.uid()::text)
  from public.library_feedback f
  left join public.library_feedback_votes v on v.feedback_id = f.id
  where f.id = any(coalesce(p_feedback_ids, array[]::text[]))
    and f.status = 'active'
  group by f.id;
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

-- Activity notifications are generated in the database so direct REST writes
-- and server API writes follow the same rules. The actor never chooses the
-- recipient or message.
create or replace function public.create_library_activity_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient text;
  v_actor text;
  v_type text;
  v_book_id text;
  v_target_type text;
  v_target_id text;
  v_actor_name text;
  v_book_title text;
  v_message text;
  v_allowed boolean := true;
begin
  if tg_table_name = 'book_annotation_replies' then
    select coalesce(parent.author_id, a.author_id), a.book_id into v_recipient, v_book_id
    from public.book_annotations a
    left join public.book_annotation_replies parent on parent.id = new.parent_reply_id and parent.status = 'active'
    where a.id = new.annotation_id and a.status = 'active';
    v_actor := new.author_id;
    v_type := 'annotation_reply';
    v_target_type := 'annotation';
    v_target_id := new.annotation_id;
  elsif tg_table_name = 'book_annotation_reply_votes' then
    if new.vote_type <> 'up' then return new; end if;
    select r.author_id, a.book_id, a.id into v_recipient, v_book_id, v_target_id
    from public.book_annotation_replies r
    join public.book_annotations a on a.id = r.annotation_id
    where r.id = new.reply_id and r.status = 'active' and a.status = 'active';
    v_actor := new.user_id;
    v_type := 'annotation_reply_like';
    v_target_type := 'annotation';
  elsif tg_table_name = 'book_annotation_votes' then
    if new.vote_type <> 'up' then return new; end if;
    select a.author_id, a.book_id into v_recipient, v_book_id
    from public.book_annotations a where a.id = new.annotation_id and a.status = 'active';
    v_actor := new.user_id;
    v_type := 'annotation_like';
    v_target_type := 'annotation';
    v_target_id := new.annotation_id;
  elsif tg_table_name = 'book_annotation_favorites' then
    select a.author_id, a.book_id into v_recipient, v_book_id
    from public.book_annotations a where a.id = new.annotation_id and a.status = 'active';
    v_actor := new.user_id;
    v_type := 'annotation_favorite';
    v_target_type := 'annotation';
    v_target_id := new.annotation_id;
  elsif tg_table_name = 'book_review_likes' then
    select r.author_id, r.book_id into v_recipient, v_book_id
    from public.book_reviews r where r.id = new.review_id and r.status = 'active';
    v_actor := new.user_id;
    v_type := 'review_like';
    v_target_type := 'review';
    v_target_id := new.review_id;
  elsif tg_table_name = 'book_review_favorites' then
    select r.author_id, r.book_id into v_recipient, v_book_id
    from public.book_reviews r where r.id = new.review_id and r.status = 'active';
    v_actor := new.user_id;
    v_type := 'review_favorite';
    v_target_type := 'review';
    v_target_id := new.review_id;
  elsif tg_table_name = 'library_feedback' then
    if new.parent_id is null then return new; end if;
    select f.author_id, f.book_id into v_recipient, v_book_id
    from public.library_feedback f where f.id = new.parent_id and f.status = 'active';
    v_actor := new.author_id;
    v_type := 'feedback_reply';
    v_target_type := 'feedback';
    v_target_id := new.parent_id;
  else
    return new;
  end if;

  if v_recipient is null or v_actor is null or v_recipient = v_actor then return new; end if;

  select case v_type
    when 'annotation_reply' then s.notify_annotation_replies
    when 'annotation_reply_like' then s.notify_annotation_likes
    when 'annotation_like' then s.notify_annotation_likes
    when 'annotation_favorite' then s.notify_annotation_favorites
    when 'review_like' then s.notify_review_likes
    when 'review_favorite' then s.notify_review_likes
    when 'feedback_reply' then s.notify_feedback_replies
    else true end
  into v_allowed
  from public.library_user_settings s where s.user_id = v_recipient;
  if coalesce(v_allowed, true) = false then return new; end if;

  select coalesce(nullif(u.public_display_name, ''), '讀者') into v_actor_name
  from public.users u where u.id = v_actor;
  select b.title_zh into v_book_title from public.library_books b where b.id = v_book_id;

  v_message := case v_type
    when 'annotation_reply' then format('%s 回覆了你在《%s》的標注', v_actor_name, coalesce(v_book_title, '館藏'))
    when 'annotation_reply_like' then format('%s 對你在《%s》的回覆表示讚賞', v_actor_name, coalesce(v_book_title, '館藏'))
    when 'annotation_like' then format('%s 對你在《%s》的標注表示讚賞', v_actor_name, coalesce(v_book_title, '館藏'))
    when 'annotation_favorite' then format('%s 收藏了你在《%s》的標注', v_actor_name, coalesce(v_book_title, '館藏'))
    when 'review_like' then format('%s 喜歡你對《%s》的評論', v_actor_name, coalesce(v_book_title, '館藏'))
    when 'review_favorite' then format('%s 收藏了你對《%s》的評論', v_actor_name, coalesce(v_book_title, '館藏'))
    when 'feedback_reply' then format('%s 回覆了你的讀者回饋', v_actor_name)
    else '你有一則新的館藏通知' end;

  insert into public.library_notifications(user_id, actor_id, type, book_id, target_type, target_id, message)
  values (v_recipient, v_actor, v_type, v_book_id, v_target_type, v_target_id, v_message)
  on conflict (user_id, type, actor_id, target_type, target_id) do update
    set message = excluded.message, read_at = null, created_at = now();
  return new;
end;
$$;

drop trigger if exists library_notify_annotation_reply on public.book_annotation_replies;
create trigger library_notify_annotation_reply after insert on public.book_annotation_replies
for each row execute function public.create_library_activity_notification();
drop trigger if exists library_notify_annotation_vote on public.book_annotation_votes;
create trigger library_notify_annotation_vote after insert or update of vote_type on public.book_annotation_votes
for each row execute function public.create_library_activity_notification();
drop trigger if exists library_notify_annotation_reply_vote on public.book_annotation_reply_votes;
create trigger library_notify_annotation_reply_vote after insert or update of vote_type on public.book_annotation_reply_votes
for each row execute function public.create_library_activity_notification();
drop trigger if exists library_notify_annotation_favorite on public.book_annotation_favorites;
create trigger library_notify_annotation_favorite after insert on public.book_annotation_favorites
for each row execute function public.create_library_activity_notification();
drop trigger if exists library_notify_review_like on public.book_review_likes;
create trigger library_notify_review_like after insert on public.book_review_likes
for each row execute function public.create_library_activity_notification();
drop trigger if exists library_notify_review_favorite on public.book_review_favorites;
create trigger library_notify_review_favorite after insert on public.book_review_favorites
for each row execute function public.create_library_activity_notification();
drop trigger if exists library_notify_feedback_reply on public.library_feedback;
create trigger library_notify_feedback_reply after insert on public.library_feedback
for each row execute function public.create_library_activity_notification();

-- Broadcast only compact deltas. Clients fetch authorized, authoritative rows
-- through REST after receiving an event or reconnecting with a sequence id.
create or replace function public.broadcast_library_realtime_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_topic text;
  v_resource text;
  v_target_id text;
  v_book_id text;
  v_user_id text;
  v_visibility text;
  v_sequence_id bigint;
  v_operation text := lower(tg_op);
  v_payload jsonb;
begin
  if tg_table_name = 'library_notifications' then
    v_user_id := coalesce(new.user_id, old.user_id);
    v_topic := 'user:' || v_user_id || ':notifications';
    v_resource := 'notification';
    v_target_id := coalesce(new.id, old.id)::text;
  elsif tg_table_name = 'book_ratings' then
    v_book_id := coalesce(new.book_id, old.book_id);
    v_resource := 'book_rating';
    v_target_id := v_book_id;
  elsif tg_table_name = 'book_favorites' then
    v_book_id := coalesce(new.book_id, old.book_id);
    v_resource := 'book_favorite';
    v_target_id := v_book_id;
  elsif tg_table_name = 'book_reviews' then
    v_book_id := coalesce(new.book_id, old.book_id);
    v_resource := 'review';
    v_target_id := coalesce(new.id, old.id);
  elsif tg_table_name = 'book_review_likes' then
    select r.book_id into v_book_id from public.book_reviews r where r.id = coalesce(new.review_id, old.review_id);
    v_resource := 'review_like';
    v_target_id := coalesce(new.review_id, old.review_id);
  elsif tg_table_name = 'book_review_favorites' then
    select r.book_id into v_book_id from public.book_reviews r where r.id = coalesce(new.review_id, old.review_id);
    v_resource := 'review_favorite';
    v_target_id := coalesce(new.review_id, old.review_id);
  elsif tg_table_name = 'book_annotations' then
    v_book_id := coalesce(new.book_id, old.book_id);
    v_resource := 'annotation';
    v_target_id := coalesce(new.id, old.id);
    if tg_op = 'INSERT' and new.visibility = 'private' then return new; end if;
    if tg_op = 'UPDATE' and old.visibility = 'private' and new.visibility = 'private' then return new; end if;
    if tg_op = 'DELETE' and old.visibility = 'private' then return old; end if;
  elsif tg_table_name = 'book_annotation_replies' then
    select a.book_id, a.visibility into v_book_id, v_visibility from public.book_annotations a where a.id = coalesce(new.annotation_id, old.annotation_id);
    if v_visibility = 'private' then
      if tg_op = 'DELETE' then return old; end if;
      return new;
    end if;
    v_resource := 'annotation_reply';
    v_target_id := coalesce(new.annotation_id, old.annotation_id);
  elsif tg_table_name = 'book_annotation_reply_votes' then
    select a.book_id, a.visibility into v_book_id, v_visibility
    from public.book_annotation_replies r join public.book_annotations a on a.id = r.annotation_id
    where r.id = coalesce(new.reply_id, old.reply_id);
    if v_visibility = 'private' then
      if tg_op = 'DELETE' then return old; end if;
      return new;
    end if;
    v_resource := 'annotation_reply_vote';
    v_target_id := coalesce(new.reply_id, old.reply_id);
  elsif tg_table_name = 'book_annotation_votes' then
    select a.book_id, a.visibility into v_book_id, v_visibility
    from public.book_annotations a where a.id = coalesce(new.annotation_id, old.annotation_id);
    if v_visibility = 'private' then
      if tg_op = 'DELETE' then return old; end if;
      return new;
    end if;
    v_resource := 'annotation_vote';
    v_target_id := coalesce(new.annotation_id, old.annotation_id);
  elsif tg_table_name = 'book_annotation_favorites' then
    select a.book_id, a.visibility into v_book_id, v_visibility
    from public.book_annotations a where a.id = coalesce(new.annotation_id, old.annotation_id);
    if v_visibility = 'private' then
      if tg_op = 'DELETE' then return old; end if;
      return new;
    end if;
    v_resource := 'annotation_favorite';
    v_target_id := coalesce(new.annotation_id, old.annotation_id);
  elsif tg_table_name = 'library_feedback' then
    v_topic := 'feedback:activity';
    v_resource := 'feedback';
    v_target_id := coalesce(new.parent_id, old.parent_id, new.id, old.id);
  elsif tg_table_name = 'library_feedback_votes' then
    v_topic := 'feedback:activity';
    v_resource := 'feedback_vote';
    select coalesce(f.parent_id, f.id) into v_target_id
    from public.library_feedback f where f.id = coalesce(new.feedback_id, old.feedback_id);
  else
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if v_topic is null and v_book_id is not null then
    v_topic := 'book:' || v_book_id || ':activity';
  end if;
  if v_topic is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  insert into public.library_realtime_events(topic, resource, operation, target_id, book_id, user_id)
  values (v_topic, v_resource, v_operation, v_target_id, v_book_id, v_user_id)
  returning sequence_id into v_sequence_id;

  v_payload := jsonb_build_object(
    'version', 1,
    'sequenceId', v_sequence_id,
    'resource', v_resource,
    'operation', v_operation,
    'targetId', v_target_id,
    'bookId', v_book_id,
    'emittedAt', clock_timestamp()
  );
  -- User notification topics are private. Book activity contains only public
  -- review/annotation identifiers and stays public for signed-out readers.
  perform realtime.send(v_payload, 'delta', v_topic, v_user_id is not null);

  -- The home page uses one catalog room rather than one channel per visible
  -- book. Only changes that affect book-card aggregates are mirrored here.
  if v_book_id is not null and v_resource in ('book_rating', 'book_favorite', 'review')
     and not (tg_table_name = 'book_reviews' and tg_op = 'UPDATE' and old.status = new.status) then
    insert into public.library_realtime_events(topic, resource, operation, target_id, book_id)
    values ('catalog:activity', v_resource, v_operation, v_target_id, v_book_id)
    returning sequence_id into v_sequence_id;
    v_payload := jsonb_build_object(
      'version', 1,
      'sequenceId', v_sequence_id,
      'resource', v_resource,
      'operation', v_operation,
      'targetId', v_target_id,
      'bookId', v_book_id,
      'emittedAt', clock_timestamp()
    );
    perform realtime.send(v_payload, 'delta', 'catalog:activity', false);
  end if;

  if mod(v_sequence_id, 500) = 0 then
    delete from public.library_realtime_events where emitted_at < now() - interval '7 days';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists library_realtime_notifications on public.library_notifications;
create trigger library_realtime_notifications after insert or update or delete on public.library_notifications
for each row execute function public.broadcast_library_realtime_event();
drop trigger if exists library_realtime_book_ratings on public.book_ratings;
create trigger library_realtime_book_ratings after insert or update or delete on public.book_ratings
for each row execute function public.broadcast_library_realtime_event();
drop trigger if exists library_realtime_book_favorites on public.book_favorites;
create trigger library_realtime_book_favorites after insert or delete on public.book_favorites
for each row execute function public.broadcast_library_realtime_event();
drop trigger if exists library_realtime_reviews on public.book_reviews;
create trigger library_realtime_reviews after insert or update or delete on public.book_reviews
for each row execute function public.broadcast_library_realtime_event();
drop trigger if exists library_realtime_review_likes on public.book_review_likes;
create trigger library_realtime_review_likes after insert or delete on public.book_review_likes
for each row execute function public.broadcast_library_realtime_event();
drop trigger if exists library_realtime_review_favorites on public.book_review_favorites;
create trigger library_realtime_review_favorites after insert or delete on public.book_review_favorites
for each row execute function public.broadcast_library_realtime_event();
drop trigger if exists library_realtime_annotations on public.book_annotations;
create trigger library_realtime_annotations after insert or update or delete on public.book_annotations
for each row execute function public.broadcast_library_realtime_event();
drop trigger if exists library_realtime_annotation_replies on public.book_annotation_replies;
create trigger library_realtime_annotation_replies after insert or update or delete on public.book_annotation_replies
for each row execute function public.broadcast_library_realtime_event();
drop trigger if exists library_realtime_annotation_reply_votes on public.book_annotation_reply_votes;
create trigger library_realtime_annotation_reply_votes after insert or update or delete on public.book_annotation_reply_votes
for each row execute function public.broadcast_library_realtime_event();
drop trigger if exists library_realtime_annotation_votes on public.book_annotation_votes;
create trigger library_realtime_annotation_votes after insert or update or delete on public.book_annotation_votes
for each row execute function public.broadcast_library_realtime_event();
drop trigger if exists library_realtime_annotation_favorites on public.book_annotation_favorites;
create trigger library_realtime_annotation_favorites after insert or delete on public.book_annotation_favorites
for each row execute function public.broadcast_library_realtime_event();
drop trigger if exists library_realtime_feedback on public.library_feedback;
create trigger library_realtime_feedback after insert or update or delete on public.library_feedback
for each row execute function public.broadcast_library_realtime_event();
drop trigger if exists library_realtime_feedback_votes on public.library_feedback_votes;
create trigger library_realtime_feedback_votes after insert or update or delete on public.library_feedback_votes
for each row execute function public.broadcast_library_realtime_event();

alter table public.library_books enable row level security;
alter table public.users enable row level security;
alter table public.book_readers enable row level security;
alter table public.book_ratings enable row level security;
alter table public.book_favorites enable row level security;
alter table public.book_reviews enable row level security;
alter table public.book_review_likes enable row level security;
alter table public.book_review_favorites enable row level security;
alter table public.book_progress enable row level security;
alter table public.book_annotations enable row level security;
alter table public.book_annotation_votes enable row level security;
alter table public.book_annotation_favorites enable row level security;
alter table public.book_annotation_replies enable row level security;
alter table public.book_annotation_reply_votes enable row level security;
alter table public.library_feedback enable row level security;
alter table public.library_feedback_votes enable row level security;
alter table public.library_user_settings enable row level security;
alter table public.library_notifications enable row level security;
alter table public.library_realtime_events enable row level security;

-- Supabase owns and already enables RLS on realtime.messages. Project SQL
-- roles may create authorization policies there, but cannot ALTER the table.

revoke all on public.library_books, public.book_readers, public.book_ratings, public.book_favorites,
  public.book_reviews, public.book_review_likes, public.book_review_favorites, public.book_progress, public.book_annotations,
  public.book_annotation_votes, public.book_annotation_favorites, public.book_annotation_replies, public.book_annotation_reply_votes,
  public.library_feedback, public.library_feedback_votes, public.library_user_settings, public.library_notifications,
  public.library_realtime_events from anon, authenticated;

drop policy if exists library_books_public_read on public.library_books;
create policy library_books_public_read on public.library_books for select to anon, authenticated
  using (enabled = true and rights_status = 'reviewed');

drop policy if exists book_ratings_own_read on public.book_ratings;
drop policy if exists book_ratings_own_insert on public.book_ratings;
drop policy if exists book_ratings_own_update on public.book_ratings;
drop policy if exists book_ratings_own_delete on public.book_ratings;
create policy book_ratings_own_read on public.book_ratings for select to authenticated using (user_id = auth.uid()::text and public.library_user_is_active());
create policy book_ratings_own_insert on public.book_ratings for insert to authenticated with check (
  user_id = auth.uid()::text and public.library_user_is_active()
  and exists (select 1 from public.library_books b where b.id = book_ratings.book_id and b.enabled = true and b.rights_status = 'reviewed')
);
create policy book_ratings_own_update on public.book_ratings for update to authenticated using (user_id = auth.uid()::text and public.library_user_is_active()) with check (user_id = auth.uid()::text and public.library_user_is_active());
create policy book_ratings_own_delete on public.book_ratings for delete to authenticated using (user_id = auth.uid()::text and public.library_user_is_active());

drop policy if exists book_favorites_own_read on public.book_favorites;
drop policy if exists book_favorites_own_insert on public.book_favorites;
drop policy if exists book_favorites_own_delete on public.book_favorites;
create policy book_favorites_own_read on public.book_favorites for select to authenticated using (user_id = auth.uid()::text and public.library_user_is_active());
create policy book_favorites_own_insert on public.book_favorites for insert to authenticated with check (
  user_id = auth.uid()::text and public.library_user_is_active()
  and exists (select 1 from public.library_books b where b.id = book_favorites.book_id and b.enabled = true and b.rights_status = 'reviewed')
);
create policy book_favorites_own_delete on public.book_favorites for delete to authenticated using (user_id = auth.uid()::text and public.library_user_is_active());

drop policy if exists book_reviews_public_read on public.book_reviews;
drop policy if exists book_reviews_own_insert on public.book_reviews;
drop policy if exists book_reviews_own_update on public.book_reviews;
drop policy if exists book_reviews_own_delete on public.book_reviews;
create policy book_reviews_public_read on public.book_reviews for select to anon, authenticated
  using (status = 'active' or (author_id = auth.uid()::text and public.library_user_is_active()));
create policy book_reviews_own_insert on public.book_reviews for insert to authenticated
  with check (
    author_id = auth.uid()::text and status = 'active' and public.library_user_is_active()
    and exists (select 1 from public.library_books b where b.id = book_reviews.book_id and b.enabled = true and b.rights_status = 'reviewed')
  );
create policy book_reviews_own_update on public.book_reviews for update to authenticated
  using (author_id = auth.uid()::text and status <> 'hidden' and public.library_user_is_active())
  with check (author_id = auth.uid()::text and status in ('active', 'deleted') and public.library_user_is_active());
create policy book_reviews_own_delete on public.book_reviews for delete to authenticated
  using (author_id = auth.uid()::text and public.library_user_is_active());

drop policy if exists book_review_likes_own_read on public.book_review_likes;
drop policy if exists book_review_likes_own_insert on public.book_review_likes;
drop policy if exists book_review_likes_own_delete on public.book_review_likes;
create policy book_review_likes_own_read on public.book_review_likes for select to authenticated
  using (user_id = auth.uid()::text and public.library_user_is_active());
create policy book_review_likes_own_insert on public.book_review_likes for insert to authenticated
  with check (user_id = auth.uid()::text and public.library_user_is_active() and exists (
    select 1 from public.book_reviews r where r.id = book_review_likes.review_id and r.status = 'active'
  ));
create policy book_review_likes_own_delete on public.book_review_likes for delete to authenticated
  using (user_id = auth.uid()::text and public.library_user_is_active());

drop policy if exists book_review_favorites_own_read on public.book_review_favorites;
drop policy if exists book_review_favorites_own_insert on public.book_review_favorites;
drop policy if exists book_review_favorites_own_delete on public.book_review_favorites;
create policy book_review_favorites_own_read on public.book_review_favorites for select to authenticated
  using (user_id = auth.uid()::text and public.library_user_is_active());
create policy book_review_favorites_own_insert on public.book_review_favorites for insert to authenticated
  with check (user_id = auth.uid()::text and public.library_user_is_active() and exists (
    select 1 from public.book_reviews r where r.id = book_review_favorites.review_id and r.status = 'active'
  ));
create policy book_review_favorites_own_delete on public.book_review_favorites for delete to authenticated
  using (user_id = auth.uid()::text and public.library_user_is_active());

drop policy if exists book_progress_own_read on public.book_progress;
drop policy if exists book_progress_own_insert on public.book_progress;
drop policy if exists book_progress_own_update on public.book_progress;
create policy book_progress_own_read on public.book_progress for select to authenticated using (user_id = auth.uid()::text and public.library_user_is_active());
create policy book_progress_own_insert on public.book_progress for insert to authenticated with check (
  user_id = auth.uid()::text and public.library_user_is_active()
  and exists (select 1 from public.library_books b where b.id = book_progress.book_id and b.enabled = true and b.rights_status = 'reviewed')
);
create policy book_progress_own_update on public.book_progress for update to authenticated using (user_id = auth.uid()::text and public.library_user_is_active()) with check (user_id = auth.uid()::text and public.library_user_is_active());

drop policy if exists book_annotations_visible_read on public.book_annotations;
drop policy if exists book_annotations_own_insert on public.book_annotations;
drop policy if exists book_annotations_own_update on public.book_annotations;
drop policy if exists book_annotations_own_delete on public.book_annotations;
create policy book_annotations_visible_read on public.book_annotations for select to anon, authenticated
  using (status = 'active' and (visibility = 'public' or (author_id = auth.uid()::text and public.library_user_is_active())));
create policy book_annotations_own_insert on public.book_annotations for insert to authenticated
  with check (
    author_id = auth.uid()::text and status = 'active' and public.library_user_is_active()
    and exists (select 1 from public.library_books b where b.id = book_annotations.book_id and b.enabled = true and b.rights_status = 'reviewed')
  );
create policy book_annotations_own_update on public.book_annotations for update to authenticated
  using (author_id = auth.uid()::text and status <> 'hidden' and public.library_user_is_active())
  with check (author_id = auth.uid()::text and status in ('active', 'deleted') and public.library_user_is_active());
create policy book_annotations_own_delete on public.book_annotations for delete to authenticated
  using (author_id = auth.uid()::text and public.library_user_is_active());

drop policy if exists book_annotation_votes_own_read on public.book_annotation_votes;
drop policy if exists book_annotation_votes_own_insert on public.book_annotation_votes;
drop policy if exists book_annotation_votes_own_update on public.book_annotation_votes;
drop policy if exists book_annotation_votes_own_delete on public.book_annotation_votes;
create policy book_annotation_votes_own_read on public.book_annotation_votes for select to authenticated
  using (user_id = auth.uid()::text and public.library_user_is_active());
create policy book_annotation_votes_own_insert on public.book_annotation_votes for insert to authenticated
  with check (user_id = auth.uid()::text and public.library_user_is_active() and exists (
    select 1 from public.book_annotations a where a.id = book_annotation_votes.annotation_id and a.status = 'active'
      and (a.visibility = 'public' or a.author_id = auth.uid()::text)
  ));
create policy book_annotation_votes_own_update on public.book_annotation_votes for update to authenticated
  using (user_id = auth.uid()::text and public.library_user_is_active()) with check (user_id = auth.uid()::text and public.library_user_is_active());
create policy book_annotation_votes_own_delete on public.book_annotation_votes for delete to authenticated using (user_id = auth.uid()::text and public.library_user_is_active());

drop policy if exists book_annotation_favorites_own_read on public.book_annotation_favorites;
drop policy if exists book_annotation_favorites_own_insert on public.book_annotation_favorites;
drop policy if exists book_annotation_favorites_own_delete on public.book_annotation_favorites;
create policy book_annotation_favorites_own_read on public.book_annotation_favorites for select to authenticated
  using (user_id = auth.uid()::text and public.library_user_is_active());
create policy book_annotation_favorites_own_insert on public.book_annotation_favorites for insert to authenticated
  with check (user_id = auth.uid()::text and public.library_user_is_active() and exists (
    select 1 from public.book_annotations a where a.id = book_annotation_favorites.annotation_id
      and a.status = 'active' and a.visibility = 'public'
  ));
create policy book_annotation_favorites_own_delete on public.book_annotation_favorites for delete to authenticated
  using (user_id = auth.uid()::text and public.library_user_is_active());

drop policy if exists book_annotation_replies_visible_read on public.book_annotation_replies;
drop policy if exists book_annotation_replies_own_insert on public.book_annotation_replies;
drop policy if exists book_annotation_replies_own_update on public.book_annotation_replies;
drop policy if exists book_annotation_replies_own_delete on public.book_annotation_replies;
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
    and (
      parent_reply_id is null
      or exists (
        select 1 from public.book_annotation_replies parent
        where parent.id = book_annotation_replies.parent_reply_id
          and parent.annotation_id = book_annotation_replies.annotation_id
          and parent.status = 'active'
      )
    )
  );
create policy book_annotation_replies_own_update on public.book_annotation_replies for update to authenticated
  using (author_id = auth.uid()::text and status <> 'hidden' and public.library_user_is_active())
  with check (author_id = auth.uid()::text and status in ('active', 'deleted') and public.library_user_is_active());
create policy book_annotation_replies_own_delete on public.book_annotation_replies for delete to authenticated
  using (author_id = auth.uid()::text and public.library_user_is_active());

drop policy if exists book_annotation_reply_votes_own_read on public.book_annotation_reply_votes;
drop policy if exists book_annotation_reply_votes_own_insert on public.book_annotation_reply_votes;
drop policy if exists book_annotation_reply_votes_own_update on public.book_annotation_reply_votes;
drop policy if exists book_annotation_reply_votes_own_delete on public.book_annotation_reply_votes;
create policy book_annotation_reply_votes_own_read on public.book_annotation_reply_votes for select to authenticated
  using (user_id = auth.uid()::text and public.library_user_is_active());
create policy book_annotation_reply_votes_own_insert on public.book_annotation_reply_votes for insert to authenticated
  with check (user_id = auth.uid()::text and public.library_user_is_active() and exists (
    select 1 from public.book_annotation_replies r join public.book_annotations a on a.id = r.annotation_id
    where r.id = book_annotation_reply_votes.reply_id and r.status = 'active' and a.status = 'active'
      and (a.visibility = 'public' or a.author_id = auth.uid()::text)
  ));
create policy book_annotation_reply_votes_own_update on public.book_annotation_reply_votes for update to authenticated
  using (user_id = auth.uid()::text and public.library_user_is_active())
  with check (user_id = auth.uid()::text and public.library_user_is_active());
create policy book_annotation_reply_votes_own_delete on public.book_annotation_reply_votes for delete to authenticated
  using (user_id = auth.uid()::text and public.library_user_is_active());

drop policy if exists library_feedback_public_read on public.library_feedback;
drop policy if exists library_feedback_own_insert on public.library_feedback;
create policy library_feedback_public_read on public.library_feedback for select to anon, authenticated using (status = 'active');
create policy library_feedback_own_insert on public.library_feedback for insert to authenticated
  with check (author_id = auth.uid()::text and status = 'active' and public.library_user_is_active());

drop policy if exists library_feedback_votes_own_read on public.library_feedback_votes;
drop policy if exists library_feedback_votes_own_insert on public.library_feedback_votes;
drop policy if exists library_feedback_votes_own_update on public.library_feedback_votes;
drop policy if exists library_feedback_votes_own_delete on public.library_feedback_votes;
create policy library_feedback_votes_own_read on public.library_feedback_votes for select to authenticated
  using (user_id = auth.uid()::text and public.library_user_is_active());
create policy library_feedback_votes_own_insert on public.library_feedback_votes for insert to authenticated
  with check (user_id = auth.uid()::text and public.library_user_is_active() and exists (
    select 1 from public.library_feedback f where f.id = library_feedback_votes.feedback_id and f.status = 'active'
  ));
create policy library_feedback_votes_own_update on public.library_feedback_votes for update to authenticated
  using (user_id = auth.uid()::text and public.library_user_is_active())
  with check (user_id = auth.uid()::text and public.library_user_is_active());
create policy library_feedback_votes_own_delete on public.library_feedback_votes for delete to authenticated
  using (user_id = auth.uid()::text and public.library_user_is_active());

drop policy if exists library_user_settings_own_read on public.library_user_settings;
drop policy if exists library_user_settings_own_insert on public.library_user_settings;
drop policy if exists library_user_settings_own_update on public.library_user_settings;
create policy library_user_settings_own_read on public.library_user_settings for select to authenticated
  using (user_id = auth.uid()::text and public.library_user_is_active());
create policy library_user_settings_own_insert on public.library_user_settings for insert to authenticated
  with check (user_id = auth.uid()::text and public.library_user_is_active());
create policy library_user_settings_own_update on public.library_user_settings for update to authenticated
  using (user_id = auth.uid()::text and public.library_user_is_active())
  with check (user_id = auth.uid()::text and public.library_user_is_active());

drop policy if exists library_notifications_own_read on public.library_notifications;
drop policy if exists library_notifications_own_update on public.library_notifications;
drop policy if exists library_notifications_own_delete on public.library_notifications;
create policy library_notifications_own_read on public.library_notifications for select to authenticated
  using (user_id = auth.uid()::text and public.library_user_is_active());
create policy library_notifications_own_update on public.library_notifications for update to authenticated
  using (user_id = auth.uid()::text and public.library_user_is_active())
  with check (user_id = auth.uid()::text and public.library_user_is_active());
create policy library_notifications_own_delete on public.library_notifications for delete to authenticated
  using (user_id = auth.uid()::text and public.library_user_is_active());

drop policy if exists library_realtime_book_events_read on public.library_realtime_events;
drop policy if exists library_realtime_feedback_events_read on public.library_realtime_events;
drop policy if exists library_realtime_user_events_read on public.library_realtime_events;
create policy library_realtime_book_events_read on public.library_realtime_events for select to anon, authenticated
  using (
    book_id is not null and user_id is null
    and topic in ('book:' || book_id || ':activity', 'catalog:activity')
    and exists (select 1 from public.library_books b where b.id = library_realtime_events.book_id and b.enabled = true and b.rights_status = 'reviewed')
  );
create policy library_realtime_feedback_events_read on public.library_realtime_events for select to anon, authenticated
  using (topic = 'feedback:activity' and book_id is null and user_id is null);
create policy library_realtime_user_events_read on public.library_realtime_events for select to authenticated
  using (
    user_id = auth.uid()::text
    and topic = 'user:' || auth.uid()::text || ':notifications'
    and public.library_user_is_active()
  );

-- Realtime Broadcast authorization is checked once when a private channel is
-- joined (and again when its JWT refreshes), never on each application event.
drop policy if exists library_realtime_book_broadcast_read on realtime.messages;
drop policy if exists library_realtime_user_broadcast_read on realtime.messages;
create policy library_realtime_user_broadcast_read on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = 'user:' || auth.uid()::text || ':notifications'
    and public.library_user_is_active()
  );

grant select on public.library_books to anon, authenticated;
grant select, delete on public.book_ratings to authenticated;
grant insert (book_id, user_id, rating, updated_at) on public.book_ratings to authenticated;
grant update (rating, updated_at) on public.book_ratings to authenticated;
grant select, delete on public.book_favorites to authenticated;
grant insert (book_id, user_id) on public.book_favorites to authenticated;
grant select on public.book_reviews to anon, authenticated;
grant insert (id, book_id, author_id, content) on public.book_reviews to authenticated;
grant update (content, status, updated_at) on public.book_reviews to authenticated;
grant delete on public.book_reviews to authenticated;
grant select, delete on public.book_review_likes to authenticated;
grant insert (review_id, user_id) on public.book_review_likes to authenticated;
grant select, delete on public.book_review_favorites to authenticated;
grant insert (review_id, user_id) on public.book_review_favorites to authenticated;
grant select on public.book_progress to authenticated;
grant insert (book_id, user_id, cfi, chapter_href, percentage, updated_at) on public.book_progress to authenticated;
grant update (cfi, chapter_href, percentage, updated_at) on public.book_progress to authenticated;
grant select on public.book_annotations to anon, authenticated;
grant insert (id, book_id, author_id, chapter_href, cfi_range, quote, content, visibility) on public.book_annotations to authenticated;
grant update (content, visibility, status, updated_at) on public.book_annotations to authenticated;
grant delete on public.book_annotations to authenticated;
grant select, delete on public.book_annotation_votes to authenticated;
grant insert (annotation_id, user_id, vote_type, updated_at) on public.book_annotation_votes to authenticated;
grant update (vote_type, updated_at) on public.book_annotation_votes to authenticated;
grant select, delete on public.book_annotation_favorites to authenticated;
grant insert (annotation_id, user_id) on public.book_annotation_favorites to authenticated;
grant select on public.book_annotation_replies to anon, authenticated;
grant insert (id, annotation_id, parent_reply_id, author_id, content) on public.book_annotation_replies to authenticated;
grant update (content, status, updated_at) on public.book_annotation_replies to authenticated;
grant delete on public.book_annotation_replies to authenticated;
grant select, delete on public.book_annotation_reply_votes to authenticated;
grant insert (reply_id, user_id, vote_type, updated_at) on public.book_annotation_reply_votes to authenticated;
grant update (vote_type, updated_at) on public.book_annotation_reply_votes to authenticated;
grant select on public.library_feedback to anon, authenticated;
grant insert (id, parent_id, author_id, book_id, subject, content) on public.library_feedback to authenticated;
grant select, delete on public.library_feedback_votes to authenticated;
grant insert (feedback_id, user_id, vote_type, updated_at) on public.library_feedback_votes to authenticated;
grant update (vote_type, updated_at) on public.library_feedback_votes to authenticated;
grant select on public.library_user_settings, public.library_notifications to authenticated;
grant select on public.library_realtime_events to anon, authenticated;
grant insert (user_id) on public.library_user_settings to authenticated;
grant update (notify_annotation_replies, notify_annotation_likes, notify_annotation_favorites,
  notify_review_likes, notify_feedback_replies, annotation_visibility_threshold, updated_at) on public.library_user_settings to authenticated;
grant update (read_at) on public.library_notifications to authenticated;
grant delete on public.library_notifications to authenticated;

revoke all on function public.ensure_library_profile() from public, anon, authenticated;
revoke all on function public.update_library_profile(text) from public, anon, authenticated;
revoke all on function public.library_user_is_active() from public, anon, authenticated;
revoke all on function public.get_library_public_profiles(text[]) from public, anon, authenticated;
revoke all on function public.get_book_public_metrics(text[]) from public, anon, authenticated;
revoke all on function public.set_library_book_rating(text, integer) from public, anon, authenticated;
revoke all on function public.get_library_review_like_stats(text[]) from public, anon, authenticated;
revoke all on function public.get_library_annotation_favorite_stats(text[]) from public, anon, authenticated;
revoke all on function public.get_library_annotation_vote_stats(text[]) from public, anon, authenticated;
revoke all on function public.get_library_annotation_reply_vote_stats(text[]) from public, anon, authenticated;
revoke all on function public.get_library_feedback_vote_stats(text[]) from public, anon, authenticated;
revoke all on function public.record_book_open(text, text) from public, anon, authenticated;
revoke all on function public.create_library_activity_notification() from public, anon, authenticated;
revoke all on function public.broadcast_library_realtime_event() from public, anon, authenticated;
grant execute on function public.ensure_library_profile() to authenticated;
grant execute on function public.update_library_profile(text) to authenticated;
grant execute on function public.library_user_is_active() to authenticated;
grant execute on function public.get_library_public_profiles(text[]) to anon, authenticated;
grant execute on function public.get_book_public_metrics(text[]) to anon, authenticated;
grant execute on function public.set_library_book_rating(text, integer) to authenticated;
grant execute on function public.get_library_review_like_stats(text[]) to anon, authenticated;
grant execute on function public.get_library_annotation_favorite_stats(text[]) to anon, authenticated;
grant execute on function public.get_library_annotation_vote_stats(text[]) to anon, authenticated;
grant execute on function public.get_library_annotation_reply_vote_stats(text[]) to anon, authenticated;
grant execute on function public.get_library_feedback_vote_stats(text[]) to anon, authenticated;
grant execute on function public.record_book_open(text, text) to anon, authenticated;

commit;
