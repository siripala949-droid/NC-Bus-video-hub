# Security Specification (Phase 0: Payload-First Security TDD)

## 1. Data Invariants

1. **PII Split Isolation Invariant**: Public creator profiles at `/users/{userId}` MUST NOT contain `email` or any other PII. User email addresses are strictly isolated in `/users/{userId}/private/{privateId}` and accessible ONLY when `request.auth.uid == userId`.
2. **Follower Atomicity Invariant**: A document in `/users/{creatorId}/followers/{followerId}` can only be created or deleted if `/users/{creatorId}.followerCount` is atomically incremented (`+1`) or decremented (`-1`) in the same transaction/batch (`getAfter` verification). Conversely, `followerCount` on `/users/{creatorId}` can only change when `existsAfter` / `exists` proves a matching `/followers/{request.auth.uid}` state transition.
3. **Self-Follow Prohibition**: A user cannot follow themselves (`creatorId != followerId`).
4. **Video Ownership & Relational Invariant**: A document in `/public_videos/{videoId}` can only be created if `uploaderId == request.auth.uid`, the user has a verified email (`request.auth.token.email_verified == true`), and `/users/{request.auth.uid}` exists.
5. **Notification Fan-out Authorization Invariant**: A notification at `/users/{userId}/notifications/{notificationId}` can only be created by `senderId == request.auth.uid` if `userId` is a verified follower of `senderId` (`exists(/databases/$(database)/documents/users/$(request.auth.uid)/followers/$(userId))`) AND the referenced video exists (`exists(/databases/$(database)/documents/public_videos/$(incoming().videoId))`).
6. **Terminal State Locking on Notifications**: Once a notification's `read` status transitions from `false` to `true`, no further updates are permitted.

## 2. The "Dirty Dozen" Payloads

1. **Payload 1 (Shadow Field Injection on Profile)**: Authenticated user creates `/users/user_1` with `{ uid: "user_1", displayName: "Driver", photoURL: "", followerCount: 0, isAdmin: true, createdAt: request.time, updatedAt: request.time }` -> `PERMISSION_DENIED`.
2. **Payload 2 (Unverified Email Write)**: Authenticated user with `email_verified: false` attempts to create `/public_videos/vid_1` -> `PERMISSION_DENIED`.
3. **Payload 3 (Cross-User PII Leak)**: Authenticated `user_2` attempts `get` on `/users/user_1/private/account` -> `PERMISSION_DENIED`.
4. **Payload 4 (Fake Follower Count Inflation)**: Owner `user_1` attempts to update `/users/user_1` setting `followerCount: 9999` without an atomic follower document write -> `PERMISSION_DENIED`.
5. **Payload 5 (Orphan Follower Write without Counter Sync)**: User `user_2` attempts to create `/users/user_1/followers/user_2` without updating `/users/user_1.followerCount` in the same batch -> `PERMISSION_DENIED`.
6. **Payload 6 (Self-Follow Exploit)**: User `user_1` attempts to create `/users/user_1/followers/user_1` -> `PERMISSION_DENIED`.
7. **Payload 7 (Identity Spoofing on Video Upload)**: User `user_1` creates `/public_videos/vid_1` with `uploaderId: "user_2"` -> `PERMISSION_DENIED`.
8. **Payload 8 (Denial-of-Wallet Oversized String)**: User `user_1` creates `/public_videos/vid_1` with a 5,000-character `title` -> `PERMISSION_DENIED`.
9. **Payload 9 (ID Poisoning Attack)**: User attempts to create `/public_videos/bad$id!@#` with invalid characters -> `PERMISSION_DENIED`.
10. **Payload 10 (Spam Notification to Non-Follower)**: Creator `user_1` attempts to create `/users/user_3/notifications/notif_1` when `user_3` does not follow `user_1` -> `PERMISSION_DENIED`.
11. **Payload 11 (Terminal State Reversal on Notification)**: Recipient `user_2` attempts to update `/users/user_2/notifications/notif_1` from `read: true` back to `read: false` -> `PERMISSION_DENIED`.
12. **Payload 12 (Immutable Timestamp Tampering)**: Video owner `user_1` updates `/public_videos/vid_1` and modifies `createdAt` -> `PERMISSION_DENIED`.
