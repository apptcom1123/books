import express from "express";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

function settingsPayload(row) {
  return {
    notifyAnnotationReplies: Boolean(row.notify_annotation_replies),
    notifyAnnotationLikes: Boolean(row.notify_annotation_likes),
    notifyAnnotationFavorites: Boolean(row.notify_annotation_favorites),
    notifyReviewLikes: Boolean(row.notify_review_likes),
    notifyFeedbackReplies: Boolean(row.notify_feedback_replies),
    annotationVisibilityThreshold: Number(row.annotation_visibility_threshold ?? 50),
  };
}

router.use(requireAuth);

router.get("/", async (req, res, next) => {
  try {
    const [dashboard, settings, notifications] = await Promise.all([
      req.repositories.library.userDashboard(req.user.userId),
      req.repositories.user.settings(req.user.userId),
      req.repositories.user.notifications(req.user.userId),
    ]);
    res.json({
      user: {
        id: req.profile.id,
        email: req.profile.email,
        displayName: req.profile.display_name,
        publicDisplayName: req.profile.public_display_name,
        avatarUrl: req.profile.avatar_url,
        role: req.profile.role,
      },
      settings: settingsPayload(settings),
      notifications,
      ...dashboard,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/summary", async (req, res, next) => {
  try {
    res.json(await req.repositories.user.notificationSummary(req.user.userId));
  } catch (error) {
    next(error);
  }
});

router.get("/settings", async (req, res, next) => {
  try {
    res.json({ settings: settingsPayload(await req.repositories.user.settings(req.user.userId)) });
  } catch (error) {
    next(error);
  }
});

router.patch("/profile", async (req, res, next) => {
  try {
    const profile = await req.repositories.user.updateProfile(req.body?.publicDisplayName);
    res.json({ success: true, user: {
      id: profile.id,
      email: profile.email,
      displayName: profile.display_name,
      publicDisplayName: profile.public_display_name,
      avatarUrl: profile.avatar_url,
      role: profile.role,
    } });
  } catch (error) {
    next(error);
  }
});

router.patch("/settings", async (req, res, next) => {
  try {
    const settings = await req.repositories.user.updateSettings(req.user.userId, req.body || {});
    res.json({ success: true, settings: settingsPayload(settings) });
  } catch (error) {
    next(error);
  }
});

router.get("/notifications", async (req, res, next) => {
  try {
    const notifications = await req.repositories.user.notifications(req.user.userId);
    res.json({ notifications, unread: notifications.filter((item) => !item.read_at).length });
  } catch (error) {
    next(error);
  }
});

router.patch("/notifications/:notificationId/read", async (req, res, next) => {
  try {
    await req.repositories.user.markNotificationRead(req.user.userId, req.params.notificationId);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.post("/notifications/read-all", async (req, res, next) => {
  try {
    await req.repositories.user.markAllNotificationsRead(req.user.userId);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.delete("/notifications/:notificationId", async (req, res, next) => {
  try {
    await req.repositories.user.deleteNotification(req.user.userId, req.params.notificationId);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
