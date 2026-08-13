begin;

-- Querying book_annotation_replies from its own INSERT policy recursively
-- invokes that policy and raises 42P17. This security-definer helper exposes
-- only a boolean parent/thread validation and does not return reply contents.
create or replace function public.library_annotation_reply_parent_is_valid(p_parent_id text, p_annotation_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.book_annotation_replies parent
    where parent.id = p_parent_id
      and parent.annotation_id = p_annotation_id
      and parent.status = 'active'
  );
$$;

revoke all on function public.library_annotation_reply_parent_is_valid(text, text) from public, anon, authenticated;
grant execute on function public.library_annotation_reply_parent_is_valid(text, text) to authenticated;

drop policy if exists book_annotation_replies_own_insert on public.book_annotation_replies;
create policy book_annotation_replies_own_insert on public.book_annotation_replies for insert to authenticated
  with check (
    author_id = auth.uid()::text and status = 'active' and public.library_user_is_active()
    and exists (
      select 1 from public.book_annotations a
      where a.id = book_annotation_replies.annotation_id
        and a.status = 'active'
        and (a.visibility = 'public' or a.author_id = auth.uid()::text)
    )
    and (
      parent_reply_id is null
      or public.library_annotation_reply_parent_is_valid(parent_reply_id, annotation_id)
    )
  );

commit;
