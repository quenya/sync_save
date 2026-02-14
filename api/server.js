const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const zlib = require("zlib");

const TOKEN_TTL_MS = 1000 * 60 * 15;
const REFRESH_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const OAUTH_PROVIDERS = new Set(["google", "facebook"]);
const STORAGE_ROOT = path.join(process.cwd(), process.env.MOCK_STORAGE_PATH || "mock-storage");

function createStore() {
  return {
    users: [],
    socialAccounts: [],
    games: [],
    revisions: [],
    conflictResolutions: [],
    sessions: [],
    nextIds: {
      user: 1,
      social: 1,
      game: 1,
      revision: 1,
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

function hashBytes(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
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

function normalizeSavePath(userId, savePath) {
  const cleaned = `/${String(savePath || "").trim().replace(/^\//, "")}`;
  const namespace = `/users/${userId}/saves`;
  if (!cleaned || cleaned === "/") {
    return `${namespace}/${crypto.randomBytes(6).toString("hex")}`;
  }
  if (cleaned.startsWith(`/users/${userId}/`)) {
    return cleaned;
  }
  return `${namespace}${cleaned}`;
}

function ensureRevisionPath(userId, gameId, revisionId) {
  return path.join(STORAGE_ROOT, `users/${userId}/games/${gameId}/revisions`, `${revisionId}.zip`);
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
    const existingUser = store.users.find((item) => item.id === linkedSocial.userId);
    if (existingUser) {
      existingUser.email = email;
      existingUser.name = name;
      existingUser.deletedAt = null;
      existingUser.updatedAt = nowIso();
      return existingUser;
    }
  }

  const existingByEmail = store.users.find((item) => item.email === email);
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

function parseGameRevisionPath(pathname) {
  const match = pathname.match(/^\/games\/(\d+)\/revisions(?:\/(latest|(\d+)\/(download|resolve)))?$/);
  if (!match) {
    return null;
  }

  const gameId = Number(match[1]);
  if (!match[2]) {
    return { gameId, route: "list" };
  }
  if (match[2] === "latest") {
    return { gameId, route: "latest" };
  }
  return { gameId, route: match[4], revisionId: Number(match[3]) };
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

function assertRevisionBelongsToGame(store, gameId, revisionId) {
  const revision = store.revisions.find(
    (item) => item.id === revisionId && item.gameId === gameId,
  );
  return revision || null;
}

function getLatestRevision(store, gameId) {
  const gameRevisions = store.revisions
    .filter((item) => item.gameId === gameId)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  return gameRevisions[0] || null;
}

function withStorageDir(authUserId, gameId, fn) {
  const root = path.join(STORAGE_ROOT, `users/${authUserId}/games/${gameId}`);
  fs.mkdirSync(root, { recursive: true });
  return fn(root);
}

function createRevisionRecord(store, authUser, game, revisionPayload) {
  const revision = {
    id: store.nextIds.revision++,
    userId: authUser.id,
    gameId: game.id,
    checksum: revisionPayload.checksum,
    sizeBytes: revisionPayload.sizeBytes,
    note: revisionPayload.note,
    createdAt: nowIso(),
    updatedAt: revisionPayload.updatedAt || nowIso(),
    clientUpdatedAt: revisionPayload.clientUpdatedAt || null,
    artifactPath: revisionPayload.artifactPath || null,
    conflictResolvedFrom: revisionPayload.conflictResolvedFrom || null,
  };
  store.revisions.push(revision);
  return revision;
}

function parseArtifact(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const raw = payload.artifactBase64 || "";
  if (!raw) {
    return null;
  }

  let decoded;
  try {
    decoded = Buffer.from(raw, "base64");
  } catch (_err) {
    return { error: "invalid_base64" };
  }

  if (!decoded.length) {
    return { error: "artifact must not be empty" };
  }

  return {
    bytes: decoded,
    checksum: payload.checksum ? String(payload.checksum).trim() : hashBytes(decoded),
    sizeBytes: Number(payload.sizeBytes || decoded.length),
    compressed: zlib.gzipSync(decoded),
  };
}

function createApp(store = createStore()) {
  return http.createServer(async (req, res) => {
    try {
      const method = req.method || "GET";
      const url = new URL(req.url || "/", "http://localhost");

      if (method === "GET" && url.pathname === "/health") {
        return json(res, 200, {
          status: "ok",
          service: "api",
          storageRoot: STORAGE_ROOT,
        });
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
        store.revisions = store.revisions.filter((revision) => revision.userId !== authUser.id);

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
        const requestedSavePath = String(body.savePath || "").trim();

        if (!name || !requestedSavePath) {
          return json(res, 400, { error: "name and savePath are required" });
        }

        const savePath = normalizeSavePath(authUser.id, requestedSavePath);
        const game = {
          id: store.nextIds.game++,
          userId: authUser.id,
          name,
          savePath,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        store.games.push(game);

        withStorageDir(authUser.id, game.id, () => {});
        return json(res, 201, { game });
      }

      const revisionPath = parseGameRevisionPath(url.pathname);
      if (revisionPath) {
        const authUser = requireAuth(store, req, res);
        if (!authUser) {
          return;
        }

        const game = store.games.find((item) => item.id === revisionPath.gameId);
        if (!assertUserOwnsGame(res, authUser, game)) {
          return;
        }

        if (method === "GET" && revisionPath.route === "list") {
          const revisions = store.revisions
            .filter((item) => item.gameId === game.id)
            .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
          return json(res, 200, {
            revisions,
            savePath: game.savePath,
          });
        }

        if (method === "GET" && revisionPath.route === "latest") {
          const latest = getLatestRevision(store, game.id);
          if (!latest) {
            return json(res, 404, { error: "no_revision" });
          }
          return json(res, 200, { revision: latest });
        }

        if (method === "POST" && revisionPath.route === "list") {
          const body = await parseJsonBody(req);
          const artifact = parseArtifact(body);

          const clientUpdatedAt = body.clientUpdatedAt ? String(body.clientUpdatedAt).trim() : null;
          const clientUpdatedAtMs = clientUpdatedAt ? Date.parse(clientUpdatedAt) : null;

          if (clientUpdatedAt && !Number.isFinite(clientUpdatedAtMs)) {
            return json(res, 400, { error: "invalid_client_updated_at" });
          }

          if (artifact && artifact.error) {
            return json(res, 400, { error: artifact.error });
          }

          const checksum = artifact ? artifact.checksum : String(body.checksum || "").trim();
          const sizeBytes = artifact ? artifact.sizeBytes : Number(body.sizeBytes || 0);

          if (!checksum || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
            return json(res, 400, { error: "checksum and positive sizeBytes are required" });
          }

          const latest = getLatestRevision(store, game.id);
          const resolution = latest
            ? store.conflictResolutions
                .slice()
                .reverse()
                .find(
                  (item) =>
                    item.gameId === game.id &&
                    item.userId === authUser.id &&
                    item.revisionId === latest.id &&
                    item.strategy === "overwrite-server",
                )
            : null;

          if (
            latest &&
            clientUpdatedAt &&
            clientUpdatedAtMs < Date.parse(latest.createdAt) &&
            !resolution
          ) {
            return json(res, 409, {
              error: "revision_conflict",
              latestRevision: latest,
              message: "Upload is older than latest server revision",
            });
          }

          const revision = createRevisionRecord(store, authUser, game, {
            checksum,
            sizeBytes,
            note: String(body.note || "").trim(),
            clientUpdatedAt: clientUpdatedAt || null,
            updatedAt: clientUpdatedAtMs ? new Date(clientUpdatedAtMs).toISOString() : nowIso(),
          });

          if (artifact) {
            const artifactPath = ensureRevisionPath(authUser.id, game.id, revision.id);
            const normalizedArtifactPath = path.relative(STORAGE_ROOT, artifactPath);
            withStorageDir(authUser.id, game.id, () => {
              fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
              fs.writeFileSync(artifactPath, artifact.compressed);
            });
            revision.artifactPath = `/mock-storage/${normalizedArtifactPath}`;
          }

          return json(res, 201, { revision });
        }

        if (method === "POST" && revisionPath.route === "resolve") {
          const body = await parseJsonBody(req);
          const baseRevision = assertRevisionBelongsToGame(
            store,
            game.id,
            revisionPath.revisionId,
          );
          if (!baseRevision) {
            return json(res, 404, { error: "not_found", message: "Base revision not found" });
          }

          const strategy = String(body.strategy || "").trim();
          if (strategy !== "overwrite-server" && strategy !== "prefer-server" && strategy !== "") {
            return json(res, 400, { error: "invalid_resolution_strategy" });
          }

          store.conflictResolutions.push({
            gameId: game.id,
            userId: authUser.id,
            revisionId: baseRevision.id,
            strategy: strategy || "overwrite-server",
            createdAt: nowIso(),
          });
          return json(res, 201, {
            resolvedFrom: baseRevision.id,
            strategy: strategy || "overwrite-server",
          });
        }

        if ((method === "GET" || method === "POST") && revisionPath.route === "download") {
          const revision = assertRevisionBelongsToGame(
            store,
            game.id,
            revisionPath.revisionId,
          );
          if (!revision) {
            return json(res, 404, { error: "not_found" });
          }

          const artifactPath =
            revision.artifactPath || `/mock-storage/users/${authUser.id}/games/${game.id}/revisions/${revision.id}.zip`;

          return json(res, 200, {
            revision,
            download: {
              mode: "mock",
              artifactPath,
            },
          });
        }

        return json(res, 404, { error: "not_found" });
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
