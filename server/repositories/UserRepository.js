export class UserRepository {
  constructor(db) {
    this.db = db;
  }

  async ensureCurrentProfile() {
    const { data, error } = await this.db.rpc("ensure_library_profile");
    if (error) throw error;
    return Array.isArray(data) ? data[0] || null : data;
  }

  async publicProfiles(userIds) {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (!ids.length) return new Map();
    const { data, error } = await this.db.rpc("get_library_public_profiles", { p_user_ids: ids });
    if (error) throw error;
    return new Map((data || []).map((user) => [user.id, user]));
  }

  async updateProfile(publicDisplayName) {
    const name = String(publicDisplayName || "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (name.length < 2) throw Object.assign(new Error("INVALID_DISPLAY_NAME"), { status: 400 });
    const { data, error } = await this.db.rpc("update_library_profile", { p_public_display_name: name });
    if (error) throw error;
    return Array.isArray(data) ? data[0] || null : data;
  }

  async settings(userId) {
    let { data, error } = await this.db.from("library_user_settings").select("*").eq("user_id", userId).maybeSingle();
    if (error) throw error;
    if (!data) {
      const created = await this.db.from("library_user_settings").insert({ user_id: userId }).select("*").single();
      if (created.error) throw created.error;
      data = created.data;
    }
    return data;
  }

  async updateSettings(userId, input) {
    const map = {
      notifyAnnotationReplies: "notify_annotation_replies",
      notifyAnnotationLikes: "notify_annotation_likes",
      notifyAnnotationFavorites: "notify_annotation_favorites",
      notifyReviewLikes: "notify_review_likes",
      notifyFeedbackReplies: "notify_feedback_replies",
    };
    const payload = { updated_at: new Date().toISOString() };
    for (const [key, value] of Object.entries(input || {})) {
      if (!map[key] || typeof value !== "boolean") {
        throw Object.assign(new Error("INVALID_SETTING"), { status: 400 });
      }
      payload[map[key]] = value;
    }
    const { data, error } = await this.db.from("library_user_settings").update(payload)
      .eq("user_id", userId).select("*").single();
    if (error) throw error;
    return data;
  }

  async notifications(userId, limit = 60) {
    const { data, error } = await this.db.from("library_notifications").select("*")
      .eq("user_id", userId).order("created_at", { ascending: false }).limit(limit);
    if (error) throw error;
    return data || [];
  }

  async notificationSummary(userId) {
    const { data, error } = await this.db.from("library_notifications").select("id,read_at")
      .eq("user_id", userId).order("created_at", { ascending: false }).limit(200);
    if (error) throw error;
    const rows = data || [];
    return { total: rows.length, unread: rows.filter((row) => !row.read_at).length };
  }

  async markNotificationRead(userId, notificationId) {
    const { data, error } = await this.db.from("library_notifications")
      .update({ read_at: new Date().toISOString() }).eq("id", notificationId).eq("user_id", userId)
      .select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw Object.assign(new Error("NOTIFICATION_NOT_FOUND"), { status: 404 });
  }

  async markAllNotificationsRead(userId) {
    const { error } = await this.db.from("library_notifications")
      .update({ read_at: new Date().toISOString() }).eq("user_id", userId).is("read_at", null);
    if (error) throw error;
  }
}
