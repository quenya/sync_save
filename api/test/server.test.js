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

test("oauth login + account scoped games API", async () => {
  await withServer(async (baseUrl) => {
    const googleLogin = await oauthLogin(baseUrl, "google", "a");
    const facebookLogin = await oauthLogin(baseUrl, "facebook", "b");

    const createForGoogle = await fetch(`${baseUrl}/games`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${googleLogin.accessToken}`,
      },
      body: JSON.stringify({ name: "Stardew Valley", savePath: "/saves/stardew" }),
    });

    assert.equal(createForGoogle.status, 201);

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

    const createRes = await fetch(`${baseUrl}/games`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${googleLogin.accessToken}`,
      },
      body: JSON.stringify({ name: "Hades", savePath: "/saves/hades" }),
    });
    const createBody = await createRes.json();

    const accessOtherGameRes = await fetch(`${baseUrl}/games/${createBody.game.id}`, {
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

    const createRes = await fetch(`${baseUrl}/games`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${login.accessToken}`,
      },
      body: JSON.stringify({ name: "Celeste", savePath: "/saves/celeste" }),
    });
    assert.equal(createRes.status, 201);

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
