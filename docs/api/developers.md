# Developers API

---

### GET /api/developers
List developers.

**Authentication:** Required

**Query Params:**
| Field | Type | Required | Description |
|---|---|---|---|
| projectId | string | No | Scope by project |
| page | number | No | Pagination page |
| limit | number | No | Pagination size |

---

### POST /api/developers
Create developer profile.

**Authentication:** Required

---

### GET /api/developers/:developerId
Get developer detail.

**Authentication:** Required

---

### PATCH /api/developers/:developerId
Update developer profile.

**Authentication:** Required

---

### GET /api/developers/leaderboard
Get developer leaderboard/ranking.

**Authentication:** Required
