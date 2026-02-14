const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp, createStore } = require("../server");

async function withServer(run) {
  const app = createApp(createStore());
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  const address = app.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve) => app.close(resolve));
  }
}

async function oauthLogin(baseUrl, provider, suffix, email = null) {
  const res = await fetch(`${baseUrl}/auth/oauth/${provider}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      providerUserId: `${provider}-user-${suffix}`,
      email: email || `user-${suffix}@example.com`,
      name: `User ${suffix}`,
    }),
  });
  assert.equal(res.status, 200);
  return res.json();
}

async function createGame(baseUrl, accessToken, name = "Stardew Valley") {
  const createRes = await fetch(`${baseUrl}/games`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ name, savePath: `/saves/${name.toLowerCase().replace(/\s+/g, "-")}` }),
  });
  assert.equal(createRes.status, 201);
  return (await createRes.json()).game;
}

test("oauth login + account scoped games API", async () => {
  await withServer(async (baseUrl) => {
    const googleLogin = await oauthLogin(baseUrl, "google", "a");
    const facebookLogin = await oauthLogin(baseUrl, "facebook", "b");

    await createGame(baseUrl, googleLogin.accessToken);

    const googleGamesRes = await fetch(`${baseUrl}/games`, {
      headers: { authorization: `Bearer ${googleLogin.accessToken}` },
    });
    assert.equal(googleGamesRes.status, 200);
    const googleGames = await googleGamesRes.json();
    assert.equal(googleGames.games.length, 1);

    const facebookGamesRes = await fetch(`${baseUrl}/games`, {
      headers: { authorization: `Bearer ${facebookLogin.accessToken}` },
    });
    assert.equal(facebookGamesRes.status, 200);
    const facebookGames = await facebookGamesRes.json();
    assert.equal(facebookGames.games.length, 0);
  });
});

test("refresh token rotates session", async () => {
  await withServer(async (baseUrl) => {
    const login = await oauthLogin(baseUrl, "google", "refresh");

    const refreshRes = await fetch(`${baseUrl}/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: login.refreshToken }),
    });

    assert.equal(refreshRes.status, 200);
    const refreshed = await refreshRes.json();
    assert.notEqual(refreshed.accessToken, login.accessToken);
  });
});

test("same email links multiple providers to one user", async () => {
  await withServer(async (baseUrl) => {
    const email = "linked@example.com";
    const googleLogin = await oauthLogin(baseUrl, "google", "same-email-g", email);
    const facebookLogin = await oauthLogin(baseUrl, "facebook", "same-email-f", email);

    assert.equal(googleLogin.user.id, facebookLogin.user.id);
  });
});

test("cannot access another user's game by id", async () => {
  await withServer(async (baseUrl) => {
    const googleLogin = await oauthLogin(baseUrl, "google", "owner");
    const facebookLogin = await oauthLogin(baseUrl, "facebook", "other");

    const game = await createGame(baseUrl, googleLogin.accessToken, "Hades");

    const accessOtherGameRes = await fetch(`${baseUrl}/games/${game.id}`, {
      headers: { authorization: `Bearer ${facebookLogin.accessToken}` },
    });

    assert.equal(accessOtherGameRes.status, 403);
  });
});

test("logout invalidates old access token", async () => {
  await withServer(async (baseUrl) => {
    const login = await oauthLogin(baseUrl, "google", "logout");

    const logoutRes = await fetch(`${baseUrl}/auth/logout`, {
      method: "POST",
      headers: { authorization: `Bearer ${login.accessToken}` },
    });
    assert.equal(logoutRes.status, 204);

    const meRes = await fetch(`${baseUrl}/me`, {
      headers: { authorization: `Bearer ${login.accessToken}` },
    });
    assert.equal(meRes.status, 401);
  });
});

test("delete account revokes tokens and removes data", async () => {
  await withServer(async (baseUrl) => {
    const login = await oauthLogin(baseUrl, "google", "delete-me");

    await createGame(baseUrl, login.accessToken, "Celeste");

    const deleteRes = await fetch(`${baseUrl}/me`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${login.accessToken}` },
    });
    assert.equal(deleteRes.status, 204);

    const meRes = await fetch(`${baseUrl}/me`, {
      headers: { authorization: `Bearer ${login.accessToken}` },
    });
    assert.equal(meRes.status, 401);
  });
});

test("upload/list/latest/download revision flow", async () => {
  await withServer(async (baseUrl) => {
    const login = await oauthLogin(baseUrl, "google", "sync-flow");
    const game = await createGame(baseUrl, login.accessToken, "Slay The Spire");

    const uploadRes = await fetch(`${baseUrl}/games/${game.id}/revisions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${login.accessToken}`,
      },
      body: JSON.stringify({ checksum: "sha256:aaa", sizeBytes: 1024, note: "first" }),
    });

    assert.equal(uploadRes.status, 201);
    const uploaded = await uploadRes.json();

    const listRes = await fetch(`${baseUrl}/games/${game.id}/revisions`, {
      headers: { authorization: `Bearer ${login.accessToken}` },
    });
    assert.equal(listRes.status, 200);
    const listBody = await listRes.json();
    assert.equal(listBody.revisions.length, 1);

    const latestRes = await fetch(`${baseUrl}/games/${game.id}/revisions/latest`, {
      headers: { authorization: `Bearer ${login.accessToken}` },
    });
    assert.equal(latestRes.status, 200);

    const downloadRes = await fetch(`${baseUrl}/games/${game.id}/revisions/${uploaded.revision.id}/download`, {
      method: "POST",
      headers: { authorization: `Bearer ${login.accessToken}` },
    });

    assert.equal(downloadRes.status, 200);
    const downloadBody = await downloadRes.json();
    assert.match(downloadBody.download.artifactPath, /mock-storage/);
  });
});

test("returns conflict when client uploads stale revision", async () => {
  await withServer(async (baseUrl) => {
    const login = await oauthLogin(baseUrl, "google", "conflict");
    const game = await createGame(baseUrl, login.accessToken, "Dead Cells");

    const firstUploadRes = await fetch(`${baseUrl}/games/${game.id}/revisions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${login.accessToken}`,
      },
      body: JSON.stringify({ checksum: "sha256:first", sizeBytes: 100 }),
    });
    assert.equal(firstUploadRes.status, 201);

    const staleTime = "2000-01-01T00:00:00.000Z";
    const staleUploadRes = await fetch(`${baseUrl}/games/${game.id}/revisions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${login.accessToken}`,
      },
      body: JSON.stringify({
        checksum: "sha256:stale",
        sizeBytes: 101,
        clientUpdatedAt: staleTime,
      }),
    });

    assert.equal(staleUploadRes.status, 409);
    const staleBody = await staleUploadRes.json();
    assert.equal(staleBody.error, "revision_conflict");
  });
});
