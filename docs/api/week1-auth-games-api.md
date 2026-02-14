# Week1~3 API Spec (OAuth + Account Isolation + Save Revision Sync)

## Auth

### `GET /auth/providers`
Returns supported providers.

```json
{
  "providers": ["google", "facebook"]
}
```

### `POST /auth/oauth/:provider`
Mock OAuth callback endpoint.

Request body:

```json
{
  "providerUserId": "provider-side-sub-id",
  "email": "user@example.com",
  "name": "Player One"
}
```

Response body:

```json
{
  "user": {
    "id": 1,
    "email": "user@example.com",
    "name": "Player One"
  },
  "socialProvider": "google",
  "accessToken": "...",
  "refreshToken": "...",
  "expiresInSec": 900
}
```

Notes:
- If the same email signs in from another provider, it links into the same user account.

### `POST /auth/refresh`
Request new access token using refresh token.

### `POST /auth/logout`
Requires `Authorization: Bearer <accessToken>`.
Revokes the current user's session tokens.

## User

### `GET /me`
Requires `Authorization: Bearer <accessToken>`.

### `DELETE /me`
Requires `Authorization: Bearer <accessToken>`.
Soft-deletes user and revokes sessions.

## Games (user scoped)

### `POST /games`
Requires auth.

```json
{
  "name": "Stardew Valley",
  "savePath": "/users/alice/saves/stardew"
}
```

### `GET /games`
Requires auth. Always filtered by authenticated `userId`.

### `GET /games/:id`
Requires auth.

Responses:
- `200`: owner can fetch game details.
- `403`: authenticated user is not the owner.
- `404`: game ID not found.

## Save Revision Sync (user scoped)

### `POST /games/:id/revisions`
Upload revision metadata.

Request body:

```json
{
  "checksum": "sha256:abcd",
  "sizeBytes": 2048,
  "clientUpdatedAt": "2026-01-01T00:00:00.000Z",
  "note": "manual backup"
}
```

Responses:
- `201`: revision accepted.
- `409`: `revision_conflict` when `clientUpdatedAt` is older than latest server revision.

### `GET /games/:id/revisions`
Returns revision history in descending order (latest first).

### `GET /games/:id/revisions/latest`
Returns latest revision.

### `POST /games/:id/revisions/:revisionId/download`
Returns mock download metadata.

```json
{
  "revision": { "id": 10 },
  "download": {
    "mode": "mock",
    "artifactPath": "/mock-storage/users/1/games/2/revisions/10.zip"
  }
}
```
