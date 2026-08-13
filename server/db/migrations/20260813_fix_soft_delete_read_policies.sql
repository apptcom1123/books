begin;

-- PostgreSQL UPDATE also requires the resulting row to remain visible to the
-- caller. Public policies intentionally hide deleted rows, so authors need a
-- separate own-row SELECT policy for a soft-delete to complete. This exposes
-- no other user's content and public API queries still filter status='active'.
drop policy if exists book_annotation_replies_author_read on public.book_annotation_replies;
create policy book_annotation_replies_author_read on public.book_annotation_replies for select to authenticated
  using (author_id = auth.uid()::text and public.library_user_is_active());

drop policy if exists library_feedback_own_read on public.library_feedback;
create policy library_feedback_own_read on public.library_feedback for select to authenticated
  using (author_id = auth.uid()::text and public.library_user_is_active());

commit;
