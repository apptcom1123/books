begin;

-- New annotation anchors are mandatory in the application payload, so their
-- column privileges must be updated together with the table schema.
grant insert (
  id, book_id, author_id, chapter_href, cfi_range,
  anchor_offset_start, anchor_offset_end, cluster_key,
  quote, content, visibility
) on public.book_annotations to authenticated;

-- Readers may soft-delete only their own feedback. Public readers continue to
-- see active rows only, and status='hidden' remains moderator-owned.
drop policy if exists library_feedback_own_update on public.library_feedback;
create policy library_feedback_own_update on public.library_feedback for update to authenticated
  using (author_id = auth.uid()::text and status <> 'hidden' and public.library_user_is_active())
  with check (author_id = auth.uid()::text and status in ('active', 'deleted') and public.library_user_is_active());
grant update (status, updated_at) on public.library_feedback to authenticated;

create index if not exists idx_library_feedback_roots_cursor
  on public.library_feedback(created_at desc, id desc)
  where status = 'active' and parent_id is null;

drop function if exists public.get_library_feedback_root_page(integer, timestamptz, text, text);
create function public.get_library_feedback_root_page(
  p_limit integer,
  p_before_created_at timestamptz default null,
  p_before_id text default null,
  p_search text default null
)
returns table (
  root_id text,
  reply_count bigint,
  latest_reply_content text,
  latest_activity_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 51);
  v_search text := nullif(trim(coalesce(p_search, '')), '');
begin
  if char_length(coalesce(v_search, '')) > 100 then raise exception 'FEEDBACK_SEARCH_TOO_LONG'; end if;
  if (p_before_created_at is null) <> (p_before_id is null) then raise exception 'INVALID_FEEDBACK_CURSOR'; end if;

  return query
  with roots as (
    select f.id, f.created_at
    from public.library_feedback f
    left join public.users root_author on root_author.id = f.author_id
      and root_author.is_active = true and root_author.deleted_at is null
    where f.status = 'active'
      and f.parent_id is null
      and (p_before_created_at is null or (f.created_at, f.id) < (p_before_created_at, p_before_id))
      and (
        v_search is null
        or f.subject ilike '%' || v_search || '%'
        or f.content ilike '%' || v_search || '%'
        or coalesce(root_author.public_display_name, '') ilike '%' || v_search || '%'
        or exists (
          select 1
          from public.library_feedback reply
          left join public.users reply_author on reply_author.id = reply.author_id
            and reply_author.is_active = true and reply_author.deleted_at is null
          where reply.parent_id = f.id and reply.status = 'active'
            and (reply.content ilike '%' || v_search || '%' or coalesce(reply_author.public_display_name, '') ilike '%' || v_search || '%')
        )
      )
    order by f.created_at desc, f.id desc
    limit v_limit
  )
  select roots.id,
         (select count(*) from public.library_feedback reply where reply.parent_id = roots.id and reply.status = 'active'),
         (select reply.content from public.library_feedback reply where reply.parent_id = roots.id and reply.status = 'active' order by reply.created_at desc, reply.id desc limit 1),
         coalesce((select max(reply.created_at) from public.library_feedback reply where reply.parent_id = roots.id and reply.status = 'active'), roots.created_at)
  from roots
  order by roots.created_at desc, roots.id desc;
end;
$$;

revoke all on function public.get_library_feedback_root_page(integer, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.get_library_feedback_root_page(integer, timestamptz, text, text) to anon, authenticated;

commit;
