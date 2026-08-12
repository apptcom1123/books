import express from "express";

const router = express.Router();

router.get("/config", (_req, res) => {
  res.json({
    supabaseUrl: _req.app.locals.supabaseUrl,
    supabasePublishableKey: _req.app.locals.supabasePublishableKey,
  });
});

router.get("/status", (req, res) => {
  if (!req.user || !req.profile) return res.json({ loggedIn: false, user: null });
  res.json({
    loggedIn: true,
    user: {
      id: req.profile.id,
      email: req.profile.email,
      displayName: req.profile.display_name,
      publicDisplayName: req.profile.public_display_name,
      avatarUrl: req.profile.avatar_url,
      role: req.profile.role,
    },
  });
});

router.post("/logout", (_req, res) => res.json({ success: true }));

export default router;
