# Auth API

---

### POST /api/auth/sign-in
Sign in and issue authentication token/cookie.

**Authentication:** Not required

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| email | string | Yes | User email |
| password | string | Yes | User password |

**Response 200:** Auth payload and session state.

---

### POST /api/auth/sign-up
Create a new user account.

**Authentication:** Not required

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| fullName | string | Yes | Display name |
| email | string | Yes | Unique email |
| password | string | Yes | Account password |

**Response 201/200:** Created account metadata.

---

### POST /api/auth/forgot-password
Start password reset flow.

**Authentication:** Not required

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| email | string | Yes | Registered email |

---

### POST /api/auth/reset-password
Complete password reset using reset token.

**Authentication:** Not required

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| token | string | Yes | Reset token |
| password | string | Yes | New password |

---

### GET /api/auth/me
Get authenticated user profile.

**Authentication:** Required

**Response 200:** Current user and org context.

---

### POST /api/auth/sign-out
Terminate active session.

**Authentication:** Required

**Response 200:** Logged out confirmation.

---

### GET /api/auth/github/start
Begin GitHub OAuth flow.

**Authentication:** Optional/Not required

**Response 302/200:** Redirect URL or redirect response.

---

### GET /api/auth/github/callback
Handle GitHub OAuth callback and finalize login.

**Authentication:** Not required (OAuth callback)

**Query Params:**
| Field | Required | Description |
|---|---|---|
| code | Yes | OAuth authorization code |
| state | Optional | CSRF state value |

---

### POST /api/auth/verify-email
Verify user email token.

**Authentication:** Not required
