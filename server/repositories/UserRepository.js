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
}
