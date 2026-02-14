const http = require("http");
const crypto = require("crypto");

const TOKEN_TTL_MS = 1000 * 60 * 15;
const REFRESH_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const OAUTH_PROVIDERS = new Set(["google", "facebook"]);

function createStore() {
  return {
    users: [],
    socialAccounts: [],
    games: [],
    sessions: [],
    nextIds: {
      user: 1,
      social: 1,
      game: 1,
    },
  };
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Body too large"));
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (_err) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function createToken() {
  return crypto.randomBytes(24).toString("hex");
}

function nowIso() {
  return new Date().toISOString();
}

function sanitizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function issueSession(store, userId) {
  const accessToken = createToken();
  const refreshToken = createToken();
  const issuedAt = Date.now();
  const session = {
    userId,
    accessToken,
    refreshToken,
    accessExpiresAt: issuedAt + TOKEN_TTL_MS,
    refreshExpiresAt: issuedAt + REFRESH_TTL_MS,
  };

  store.sessions = store.sessions.filter((item) => item.userId !== userId);
  store.sessions.push(session);

  return {
    accessToken,
    refreshToken,
    expiresInSec: Math.floor(TOKEN_TTL_MS / 1000),
  };
}

function findUserByAccessToken(store, token) {
  if (!token) {
    return null;
  }

  const currentSession = store.sessions.find(
    (session) => session.accessToken === token && session.accessExpiresAt > Date.now(),
  );

  if (!currentSession) {
    return null;
  }

  const user = store.users.find((item) => item.id === currentSession.userId);
  if (!user || user.deletedAt) {
    return null;
  }

  return user;
}

function getAuthUser(store, req) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice("Bearer ".length);
  return findUserByAccessToken(store, token);
}

function normalizeProviderRequest(body) {
  return {
    providerUserId: String(body.providerUserId || "").trim(),
    email: String(body.email || "").trim().toLowerCase(),
    name: String(body.name || "").trim(),
  };
}

function upsertOAuthUser(store, provider, providerUserId, email, name) {
  const linkedSocial = store.socialAccounts.find(
    (item) => item.provider === provider && item.providerUserId === providerUserId,
  );

  if (linkedSocial) {
    const existingUser = store.users.find((item) => item.id === linkedSocial.userId && !item.deletedAt);
    if (existingUser) {
      existingUser.email = email;
      existingUser.name = name;
      existingUser.updatedAt = nowIso();
      return existingUser;
    }
  }

  const existingByEmail = store.users.find((item) => item.email === email && !item.deletedAt);
  if (existingByEmail) {
    const hasProviderLinked = store.socialAccounts.some(
      (item) => item.userId === existingByEmail.id && item.provider === provider,
    );

    if (!hasProviderLinked) {
      store.socialAccounts.push({
        id: store.nextIds.social++,
        userId: existingByEmail.id,
        provider,
        providerUserId,
        createdAt: nowIso(),
      });
    }

    existingByEmail.name = name;
    existingByEmail.updatedAt = nowIso();
    return existingByEmail;
  }

  const user = {
    id: store.nextIds.user++,
    email,
    name,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    deletedAt: null,
  };
  store.users.push(user);

  store.socialAccounts.push({
    id: store.nextIds.social++,
    userId: user.id,
    provider,
    providerUserId,
    createdAt: nowIso(),
  });

  return user;
}

function requireAuth(store, req, res) {
  const authUser = getAuthUser(store, req);
  if (!authUser) {
    json(res, 401, { error: "unauthorized" });
    return null;
  }
  return authUser;
}

function parseGameId(pathname) {
  const match = pathname.match(/^\/games\/(\d+)$/);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

function assertUserOwnsGame(res, authUser, game) {
  if (!game) {
    json(res, 404, { error: "not_found" });
    return false;
  }
  if (game.userId !== authUser.id) {
    json(res, 403, { error: "forbidden" });
    return false;
  }
  return true;
}

function createApp(store = createStore()) {
  return http.createServer(async (req, res) => {
    try {
      const method = req.method || "GET";
      const url = new URL(req.url || "/", "http://localhost");

      if (method === "GET" && url.pathname === "/health") {
        return json(res, 200, { status: "ok", service: "api" });
      }

      if (method === "GET" && url.pathname === "/auth/providers") {
        return json(res, 200, { providers: Array.from(OAUTH_PROVIDERS) });
      }

      if (method === "POST" && url.pathname.startsWith("/auth/oauth/")) {
        const provider = url.pathname.replace("/auth/oauth/", "");
        if (!OAUTH_PROVIDERS.has(provider)) {
          return json(res, 400, { error: "unsupported_provider" });
        }

        const body = await parseJsonBody(req);
        const { providerUserId, email, name } = normalizeProviderRequest(body);

        if (!providerUserId || !email || !name) {
          return json(res, 400, { error: "providerUserId, email, name are required" });
        }

        const user = upsertOAuthUser(store, provider, providerUserId, email, name);
        const tokenSet = issueSession(store, user.id);

        return json(res, 200, {
          user: sanitizeUser(user),
          socialProvider: provider,
          ...tokenSet,
        });
      }

      if (method === "POST" && url.pathname === "/auth/refresh") {
        const body = await parseJsonBody(req);
        const refreshToken = String(body.refreshToken || "");
        const currentSession = store.sessions.find(
          (item) => item.refreshToken === refreshToken && item.refreshExpiresAt > Date.now(),
        );

        if (!currentSession) {
          return json(res, 401, { error: "invalid_refresh_token" });
        }

        return json(res, 200, issueSession(store, currentSession.userId));
      }

      if (method === "POST" && url.pathname === "/auth/logout") {
        const authUser = requireAuth(store, req, res);
        if (!authUser) {
          return;
        }
        store.sessions = store.sessions.filter((session) => session.userId !== authUser.id);
        return json(res, 204, {});
      }

      if (method === "DELETE" && url.pathname === "/me") {
        const authUser = requireAuth(store, req, res);
        if (!authUser) {
          return;
        }

        const deletedAt = nowIso();
        authUser.deletedAt = deletedAt;
        authUser.updatedAt = deletedAt;
        store.sessions = store.sessions.filter((session) => session.userId !== authUser.id);
        store.games = store.games.filter((game) => game.userId !== authUser.id);
        store.socialAccounts = store.socialAccounts.filter((sa) => sa.userId !== authUser.id);

        return json(res, 204, {});
      }

      if (method === "GET" && url.pathname === "/me") {
        const authUser = requireAuth(store, req, res);
        if (!authUser) {
          return;
        }

        return json(res, 200, { user: sanitizeUser(authUser) });
      }

      if (method === "GET" && url.pathname === "/games") {
        const authUser = requireAuth(store, req, res);
        if (!authUser) {
          return;
        }

        const games = store.games.filter((item) => item.userId === authUser.id);
        return json(res, 200, { games });
      }

      if (method === "POST" && url.pathname === "/games") {
        const authUser = requireAuth(store, req, res);
        if (!authUser) {
          return;
        }

        const body = await parseJsonBody(req);
        const name = String(body.name || "").trim();
        const savePath = String(body.savePath || "").trim();

        if (!name || !savePath) {
          return json(res, 400, { error: "name and savePath are required" });
        }

        const game = {
          id: store.nextIds.game++,
          userId: authUser.id,
          name,
          savePath,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        store.games.push(game);
        return json(res, 201, { game });
      }

      if (method === "GET" && parseGameId(url.pathname)) {
        const authUser = requireAuth(store, req, res);
        if (!authUser) {
          return;
        }

        const gameId = parseGameId(url.pathname);
        const game = store.games.find((item) => item.id === gameId);
        if (!assertUserOwnsGame(res, authUser, game)) {
          return;
        }

        return json(res, 200, { game });
      }

      return json(res, 404, { error: "not_found", path: url.pathname });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const app = createApp();
  app.listen(port, "0.0.0.0", () => {
    // eslint-disable-next-line no-console
    console.log(`api listening on ${port}`);
  });
}

module.exports = {
  createApp,
  createStore,
};
