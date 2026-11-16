# Security Specification — Alif Car Import Firebase Integration

## 1. Data Invariants
1. **Admin Authority Isolation**: Only verified Google accounts belonging to the bootstrapped owner (`alifcarimports@gmail.com` with `email_verified == true`), an explicit `/admins/{uid}` record, or a verified email listed in `/config/adminAccess.adminEmails` may create, update, or delete showroom data (`/config/showroom`, `/vehicles/{vehicleId}`, `/tiktokPosts/{postId}`).
2. **No Self-Privilege Escalation**: Unauthenticated users and non-admin signed-in users cannot write to `/admins/{uid}` or `/config/adminAccess`. Only the bootstrapped owner (`alifcarimports@gmail.com`, `email_verified == true`) may create or update `/admins/{uid}`.
3. **PII Separation**: Private admin email lists (`/config/adminAccess`) and customer inquiry PII (`/inquiries/{inquiryId}`) are isolated from public showroom reads (`/config/showroom`, `/vehicles`, `/tiktokPosts`). Public visitors cannot `get` or `list` `/inquiries` or `/config/adminAccess`.
4. **Vehicle & Post Structural Integrity**: Every write to `/vehicles/{vehicleId}`, `/tiktokPosts/{postId}`, `/config/showroom`, and `/inquiries/{inquiryId}` must pass strict field allowlisting (`keys().hasAll(...)` + `keys().hasOnly(...)`), type validation, numeric bounds, enum validation (`status` in `['available', 'reserved', 'sold']`), and string/array size caps (`galleryImages.size() <= 10`).
5. **Path ID & Temporal Integrity**: All document IDs must match `^[a-zA-Z0-9_-]+$` (`<= 128` chars), document `id` fields must equal the path parameter, and server timestamps (`updatedAt` / `createdAt`) must equal `request.time`.

## 2. The "Dirty Dozen" Attack Payloads
1. **Unauthenticated Vehicle Write**: Anonymous/visitor attempts `setDoc(/vehicles/v1, ...)` -> `PERMISSION_DENIED`.
2. **Non-Admin Signed-In Write**: Signed-in Gmail user `visitor@gmail.com` (`email_verified: true`) attempts `updateDoc(/vehicles/v1, { price: 1 })` -> `PERMISSION_DENIED`.
3. **Unverified Admin Email Spoof**: Signed-in token with `email: 'alifcarimports@gmail.com'` and `email_verified: false` attempts write -> `PERMISSION_DENIED`.
4. **Self-Admin Escalation**: Non-admin signed-in user attempts `setDoc(/admins/${uid}, { email: 'attacker@gmail.com', role: 'admin', createdAt: request.time })` -> `PERMISSION_DENIED`.
5. **Shadow Field Injection on Vehicle**: Admin sends valid vehicle payload plus ghost field `isVerified: true` -> `PERMISSION_DENIED`.
6. **Oversized ID Poisoning**: Attacker/caller attempts `get(/vehicles/${'a'.repeat(200)})` or write with 200-char ID or invalid characters `../etc` -> `PERMISSION_DENIED`.
7. **Invalid Status Enum**: Vehicle payload sets `status: 'hacked'` instead of `available | reserved | sold` -> `PERMISSION_DENIED`.
8. **Negative / NaN Price**: Vehicle payload sets `price: -500` -> `PERMISSION_DENIED`.
9. **Unbounded Gallery Array Flood**: Vehicle payload includes `galleryImages` with 25 entries (`> 10` cap) -> `PERMISSION_DENIED`.
10. **PII Leak via Inquiries List/Get**: Non-admin authenticated user attempts `getDocs(/inquiries)` or `getDoc(/inquiries/inq_1)` -> `PERMISSION_DENIED`.
11. **Admin Allowlist Exposure**: Unauthenticated or non-admin user attempts `getDoc(/config/adminAccess)` -> `PERMISSION_DENIED`.
12. **Client Timestamp Forgery**: Inquiry or config write passes a forged past/future timestamp instead of `request.time` -> `PERMISSION_DENIED`.
