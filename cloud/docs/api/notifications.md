# Notifications API

---

### GET /api/notifications
List notifications for current user.

**Authentication:** Required

**Query Params:**
- page
- limit
- unreadOnly

---

### PATCH /api/notifications/:id/read
Mark one notification as read.

**Authentication:** Required

---

### PATCH /api/notifications/read-all
Mark all notifications as read.

**Authentication:** Required

---

### POST /api/notifications/brevo
Send transactional email via Brevo integration path.

**Authentication:** Service or internal auth depending on deployment policy
