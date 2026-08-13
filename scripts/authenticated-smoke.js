import "dotenv/config";

// Destructive-looking mutations below are temporary and are restored or soft-deleted in cleanup.

const baseUrl = String(process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3001}`).replace(/\/$/, "");
const accessToken = String(process.env.SUPABASE_TEST_ACCESS_TOKEN || "").trim();

if (!accessToken) {
  console.error("Missing SUPABASE_TEST_ACCESS_TOKEN. Sign in once, copy the temporary access token, and set it only for this command.");
  process.exit(1);
}

async function api(method, endpoint, body) {
  const response = await fetch(`${baseUrl}/api${endpoint}`, {
    method,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let result = {};
  try { result = await response.json(); } catch {}
  if (!response.ok) {
    const message = result.message || result.error || `${response.status} ${response.statusText}`;
    throw new Error(`${method} ${endpoint}: ${message}`);
  }
  return result;
}

const get = (endpoint) => api("GET", endpoint);
const post = (endpoint, body = {}) => api("POST", endpoint, body);
const put = (endpoint, body = {}) => api("PUT", endpoint, body);
const patch = (endpoint, body = {}) => api("PATCH", endpoint, body);
const remove = (endpoint) => api("DELETE", endpoint);
const marker = `authenticated-smoke-${Date.now()}`;

let selectedBook = null;
let originalRating = 0;
let favoriteToggled = false;
let settingsChanged = false;
let originalReviewLikes = null;
let originalAnnotationThreshold = null;
let reviewId = null;
let deletedReviewId = null;
let annotationId = null;
let replyId = null;
let feedbackRootId = null;
let feedbackReplyId = null;

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function cleanup() {
  const jobs = [];
  if (feedbackReplyId) jobs.push(() => remove(`/feedback/${feedbackReplyId}`));
  if (feedbackRootId) jobs.push(() => remove(`/feedback/${feedbackRootId}`));
  if (replyId) jobs.push(() => remove(`/annotation-replies/${replyId}`));
  if (annotationId) jobs.push(() => remove(`/annotations/${annotationId}`));
  if (reviewId) jobs.push(() => remove(`/reviews/${reviewId}`));
  if (selectedBook && favoriteToggled) jobs.push(() => post(`/books/${selectedBook.id}/favorite`));
  if (selectedBook) jobs.push(() => put(`/books/${selectedBook.id}/rating`, { rating: originalRating }));
  if (settingsChanged && originalReviewLikes !== null && originalAnnotationThreshold !== null) {
    jobs.push(() => patch("/me/settings", {
      notifyReviewLikes: originalReviewLikes,
      annotationVisibilityThreshold: originalAnnotationThreshold,
    }));
  }
  for (const job of jobs) {
    try { await job(); } catch (error) { console.error(`Cleanup warning: ${error.message}`); }
  }
}

try {
  const auth = await get("/auth/status");
  check(auth.loggedIn && auth.user?.id, "Access token was not accepted as a signed-in user.");
  console.log(`OK authentication (${auth.user.publicDisplayName || auth.user.displayName || auth.user.email})`);

  const account = await get("/me");
  check(account.settings && account.stats && Array.isArray(account.notifications), "Personal center payload is incomplete.");
  console.log("OK personal center, settings and notifications");

  const catalog = await get("/books?limit=200");
  const reviewedBookIds = new Set((account.reviews || []).map((review) => review.book_id));
  selectedBook = catalog.books.find((book) => !reviewedBookIds.has(book.id));
  check(selectedBook, "No unused book is available for a temporary review.");
  originalRating = Number(selectedBook.viewer?.rating || 0);

  originalReviewLikes = Boolean(account.settings.notifyReviewLikes);
  originalAnnotationThreshold = Number(account.settings.annotationVisibilityThreshold ?? 50);
  const testThreshold = originalAnnotationThreshold === 65 ? 60 : 65;
  await patch("/me/settings", {
    notifyReviewLikes: !originalReviewLikes,
    annotationVisibilityThreshold: testThreshold,
  });
  settingsChanged = true;
  const restoredSettings = await patch("/me/settings", {
    notifyReviewLikes: originalReviewLikes,
    annotationVisibilityThreshold: originalAnnotationThreshold,
  });
  settingsChanged = false;
  check(restoredSettings.settings.notifyReviewLikes === originalReviewLikes, "Notification setting was not restored.");
  check(restoredSettings.settings.annotationVisibilityThreshold === originalAnnotationThreshold, "Annotation threshold was not restored.");
  console.log("OK notification and annotation threshold settings update and restore");

  const favorite = await post(`/books/${selectedBook.id}/favorite`);
  favoriteToggled = true;
  check(favorite.viewer?.isFavorite !== selectedBook.viewer?.isFavorite, "Favorite did not toggle.");
  const favoriteRestored = await post(`/books/${selectedBook.id}/favorite`);
  favoriteToggled = false;
  check(favoriteRestored.viewer?.isFavorite === selectedBook.viewer?.isFavorite, "Favorite did not restore.");
  console.log("OK book favorite toggle and restore");

  const testRating = originalRating === 5 ? 4 : 5;
  const rated = await put(`/books/${selectedBook.id}/rating`, { rating: testRating });
  check(rated.viewer?.rating === testRating, "Rating did not update.");
  const ratingRestored = await put(`/books/${selectedBook.id}/rating`, { rating: originalRating });
  check(ratingRestored.viewer?.rating === originalRating, "Rating did not restore.");
  console.log("OK rating update and restore");

  const reviewCreated = await put(`/books/${selectedBook.id}/review`, { content: marker });
  reviewId = reviewCreated.review?.id;
  check(reviewId && reviewCreated.review.content === marker, "Review was not created.");
  const reviewEdited = await put(`/books/${selectedBook.id}/review`, { content: `${marker}-edited` });
  check(reviewEdited.review?.id === reviewId && reviewEdited.review.content.endsWith("-edited"), "Review was not edited.");
  const liked = await post(`/reviews/${reviewId}/like`);
  check(liked.review?.viewerLiked === true, "Review like did not toggle on.");
  const unliked = await post(`/reviews/${reviewId}/like`);
  check(unliked.review?.viewerLiked === false, "Review like did not toggle off.");
  const reviewSaved = await post(`/reviews/${reviewId}/favorite`);
  check(reviewSaved.review?.viewerFavorite === true, "Review favorite did not toggle on.");
  const reviewUnsaved = await post(`/reviews/${reviewId}/favorite`);
  check(reviewUnsaved.review?.viewerFavorite === false, "Review favorite did not toggle off.");
  await remove(`/reviews/${reviewId}`);
  deletedReviewId = reviewId;
  reviewId = null;
  await put(`/books/${selectedBook.id}/rating`, { rating: originalRating });
  console.log("OK review create, edit, like, save, restore and delete");

  const annotationCreated = await post(`/books/${selectedBook.id}/annotations`, {
    chapterHref: "smoke-test.xhtml",
    cfiRange: "epubcfi(/6/2!/4/2:0)",
    anchorOffsetStart: 10,
    anchorOffsetEnd: 30,
    quote: "temporary smoke test",
    content: marker,
    visibility: "public",
  });
  annotationId = annotationCreated.annotation?.id;
  check(annotationId, "Annotation was not created.");
  const annotationEdited = await patch(`/annotations/${annotationId}`, { content: `${marker}-edited`, visibility: "public" });
  check(annotationEdited.annotation?.content.endsWith("-edited"), "Annotation was not edited.");
  const voted = await post(`/annotations/${annotationId}/vote`, { voteType: "up" });
  check(voted.annotation?.viewerVote === "up", "Annotation vote did not toggle on.");
  await post(`/annotations/${annotationId}/vote`, { voteType: "none" });
  const saved = await post(`/annotations/${annotationId}/favorite`);
  check(saved.annotation?.viewerFavorite === true, "Annotation favorite did not toggle on.");
  await post(`/annotations/${annotationId}/favorite`);
  const replied = await post(`/annotations/${annotationId}/replies`, { content: `${marker}-reply` });
  const ownReply = replied.annotation?.replies?.find((reply) => reply.isOwner && reply.content === `${marker}-reply`);
  replyId = ownReply?.id || null;
  check(replyId, "Annotation reply was not created.");
  const replyVoted = await post(`/annotation-replies/${replyId}/vote`, { voteType: "up" });
  const votedReply = replyVoted.annotation?.replies?.find((reply) => reply.id === replyId);
  check(votedReply?.viewerVote === "up", "Annotation reply vote did not toggle on.");
  const replyVoteRestored = await post(`/annotation-replies/${replyId}/vote`, { voteType: "none" });
  const restoredReply = replyVoteRestored.annotation?.replies?.find((reply) => reply.id === replyId);
  check(!restoredReply?.viewerVote, "Annotation reply vote did not restore.");
  await remove(`/annotation-replies/${replyId}`);
  replyId = null;
  await remove(`/annotations/${annotationId}`);
  annotationId = null;
  console.log("OK annotation create, edit, vote, save, reply vote and delete");

  const feedbackCreated = await post("/feedback", { subject: marker, content: `${marker}-root` });
  const ownRoot = feedbackCreated.messages?.find((message) => !message.parent_id && message.isOwner && message.content === `${marker}-root`);
  feedbackRootId = ownRoot?.id || null;
  check(feedbackRootId, "Feedback discussion was not created.");
  const feedbackReplied = await post("/feedback", { parentId: feedbackRootId, content: `${marker}-reply` });
  const ownFeedbackReply = feedbackReplied.messages?.find((message) => message.parent_id === feedbackRootId && message.isOwner && message.content === `${marker}-reply`);
  feedbackReplyId = ownFeedbackReply?.id || null;
  check(feedbackReplyId, "Feedback reply was not created.");
  const feedbackVoted = await post(`/feedback/${feedbackReplyId}/vote`, { voteType: "up" });
  const votedFeedbackReply = feedbackVoted.message;
  check(votedFeedbackReply?.viewerVote === "up", "Feedback vote did not toggle on.");
  const feedbackVoteRestored = await post(`/feedback/${feedbackReplyId}/vote`, { voteType: "none" });
  const restoredFeedbackReply = feedbackVoteRestored.message;
  check(!restoredFeedbackReply?.viewerVote, "Feedback vote did not restore.");
  const feedbackSearch = await get(`/feedback?limit=24&q=${encodeURIComponent(marker)}`);
  check(feedbackSearch.messages?.some((message) => message.id === feedbackRootId), "Feedback search did not return the new discussion.");
  await remove(`/feedback/${feedbackReplyId}`);
  feedbackReplyId = null;
  await remove(`/feedback/${feedbackRootId}`);
  feedbackRootId = null;
  console.log("OK feedback discussion create, reply, vote, search and delete");

  const finalAccount = await get("/me");
  check(!(finalAccount.reviews || []).some((review) => review.id === deletedReviewId), "Temporary review remains active.");
  console.log("OK cleanup and final personal center reload");
  console.log("\nAuthenticated smoke test passed. Cross-user notification delivery still requires a second signed-in account.");
} catch (error) {
  console.error(`\nAuthenticated smoke test failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await cleanup();
}
