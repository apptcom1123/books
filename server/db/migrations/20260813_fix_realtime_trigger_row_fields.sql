begin;

-- The same trigger function serves tables with different row shapes.
-- PostgreSQL expressions are not guaranteed to short-circuit, so the former
-- catalog condition could evaluate OLD.status for favorites, ratings, votes,
-- and annotations even though those tables do not have a status column. The
-- resulting 42703 error rolled back otherwise valid authenticated mutations.
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
  v_catalog_changed boolean := true;
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
    if tg_op = 'UPDATE' then
      v_catalog_changed := (to_jsonb(old) ->> 'status') is distinct from (to_jsonb(new) ->> 'status');
    end if;
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
  perform realtime.send(v_payload, 'delta', v_topic, v_user_id is not null);

  if v_book_id is not null and v_resource in ('book_rating', 'book_favorite', 'review')
     and v_catalog_changed then
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

-- Exercise the real favorite trigger inside a subtransaction. The deliberate
-- ZX001 exception rolls back the probe row and its Realtime events. Any trigger
-- error (including 42703) is not caught and rolls back this migration instead.
do $$
declare
  v_user_id text;
  v_book_id text;
begin
  select u.id, b.id into v_user_id, v_book_id
  from public.users u
  cross join public.library_books b
  where u.is_active = true and u.deleted_at is null
    and b.enabled = true and b.rights_status = 'reviewed'
    and not exists (
      select 1 from public.book_favorites f
      where f.user_id = u.id and f.book_id = b.id
    )
  limit 1;

  if v_user_id is null or v_book_id is null then
    raise notice 'Realtime trigger probe skipped: no unused user/book pair';
    return;
  end if;

  begin
    insert into public.book_favorites(book_id, user_id) values (v_book_id, v_user_id);
    raise exception using errcode = 'ZX001', message = 'ROLLBACK_REALTIME_TRIGGER_PROBE';
  exception
    when sqlstate 'ZX001' then null;
  end;
end;
$$;

commit;
