export class UserRepository {
  constructor(db) {
    this.db = db;
  }

  async upsertFromAuth(authUser) {
    const metadata = authUser.user_metadata || {};
    const displayName = String(metadata.full_name || metadata.name || authUser.email?.split("@")[0] || "讀者").slice(0, 80);
    const googleSub = String(metadata.sub || metadata.provider_id || authUser.id);
    const profile = {
      id: authUser.id,
      google_sub: googleSub,
      email: authUser.email,
      display_name: displayName,
      public_display_name: displayName,
      avatar_url: metadata.avatar_url || metadata.picture || null,
      last_login_at: new Date().toISOString(),
      is_active: true,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await this.db
      .from("users")
      .upsert(profile, { onConflict: "id" })
      .select("id,email,display_name,public_display_name,avatar_url,role,is_active")
      .single();
    if (error) throw error;
    return data;
  }

  async publicProfiles(userIds) {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (!ids.length) return new Map();
    const { data, error } = await this.db
      .from("users")
      .select("id,public_display_name,avatar_url,role")
      .in("id", ids);
    if (error) throw error;
    return new Map((data || []).map((user) => [user.id, user]));
  }
}
