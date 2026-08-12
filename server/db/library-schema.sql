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

create or replace view public.book_public_metrics
with (security_invoker = true)
as
select b.id as book_id,
       coalesce(r.reader_count, 0)::bigint as reader_count,
       coalesce(rt.rating_count, 0)::bigint as rating_count,
       coalesce(rt.average_rating, 0)::numeric(4,2) as average_rating,
       coalesce(f.favorite_count, 0)::bigint as favorite_count,
       coalesce(a.annotation_count, 0)::bigint as annotation_count
from public.library_books b
left join (select book_id, count(*) reader_count from public.book_readers group by book_id) r on r.book_id = b.id
left join (select book_id, count(*) rating_count, avg(rating) average_rating from public.book_ratings group by book_id) rt on rt.book_id = b.id
left join (select book_id, count(*) favorite_count from public.book_favorites group by book_id) f on f.book_id = b.id
left join (select book_id, count(*) annotation_count from public.book_annotations where status = 'active' and visibility = 'public' group by book_id) a on a.book_id = b.id
where b.enabled = true and b.rights_status = 'reviewed';

create or replace function public.record_book_open(p_book_id text, p_reader_key text, p_user_id text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.library_books where id = p_book_id and enabled = true and rights_status = 'reviewed') then
    raise exception 'BOOK_NOT_AVAILABLE';
  end if;
  insert into public.book_readers(book_id, reader_key, user_id)
  values (p_book_id, p_reader_key, p_user_id)
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
revoke all on public.book_public_metrics from anon, authenticated;
revoke all on function public.record_book_open(text, text, text) from public, anon, authenticated;

grant select, insert, update, delete on public.library_books, public.book_readers, public.book_ratings,
  public.book_favorites, public.book_progress, public.book_annotations, public.book_annotation_votes,
  public.book_annotation_replies, public.library_feedback to service_role;
grant select on public.book_public_metrics to service_role;
grant execute on function public.record_book_open(text, text, text) to service_role;

commit;
