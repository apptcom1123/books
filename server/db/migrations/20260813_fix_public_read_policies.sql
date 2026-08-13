begin;

-- Public readers must never need EXECUTE on the authenticated-only
-- library_user_is_active() function. PostgreSQL may evaluate either side of
-- an OR expression, so public and owner access are deliberately separate.

drop policy if exists book_reviews_public_read on public.book_reviews;
drop policy if exists book_reviews_own_read on public.book_reviews;
create policy book_reviews_public_read on public.book_reviews for select to anon, authenticated
  using (status = 'active');
create policy book_reviews_own_read on public.book_reviews for select to authenticated
  using (author_id = auth.uid()::text and public.library_user_is_active());

drop policy if exists book_annotations_visible_read on public.book_annotations;
drop policy if exists book_annotations_own_read on public.book_annotations;
create policy book_annotations_visible_read on public.book_annotations for select to anon, authenticated
  using (status = 'active' and visibility = 'public');
create policy book_annotations_own_read on public.book_annotations for select to authenticated
  using (author_id = auth.uid()::text and public.library_user_is_active());

drop policy if exists book_annotation_replies_visible_read on public.book_annotation_replies;
drop policy if exists book_annotation_replies_own_read on public.book_annotation_replies;
create policy book_annotation_replies_visible_read on public.book_annotation_replies for select to anon, authenticated
  using (status = 'active' and exists (
    select 1 from public.book_annotations a
    where a.id = book_annotation_replies.annotation_id
      and a.status = 'active'
      and a.visibility = 'public'
  ));
create policy book_annotation_replies_own_read on public.book_annotation_replies for select to authenticated
  using (status = 'active' and public.library_user_is_active() and exists (
    select 1 from public.book_annotations a
    where a.id = book_annotation_replies.annotation_id
      and a.status = 'active'
      and a.author_id = auth.uid()::text
  ));

commit;
