async function resolveSupabaseUser(req) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const { data, error } = await req.app.locals.supabaseAuthClient.auth.getClaims(token);
  const claims = data?.claims;
  if (error || !claims?.sub) return null;
  return {
    id: claims.sub,
    email: claims.email || null,
    user_metadata: claims.user_metadata || {},
    app_metadata: claims.app_metadata || {},
  };
}

export async function authMiddleware(req, _res, next) {
  try {
    req.authUser = await resolveSupabaseUser(req);
    req.user = req.authUser ? { userId: req.authUser.id, email: req.authUser.email } : null;
    next();
  } catch (error) {
    console.error("Supabase token verification failed:", error.message);
    req.authUser = null;
    req.user = null;
    next();
  }
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "AUTH_REQUIRED", message: "請先使用 Google 帳號登入。" });
  }
  next();
}

export async function attachProfile(req, _res, next) {
  if (!req.authUser) return next();
  try {
    req.profile = await req.app.locals.repositories.user.upsertFromAuth(req.authUser);
    next();
  } catch (error) {
    next(error);
  }
}
