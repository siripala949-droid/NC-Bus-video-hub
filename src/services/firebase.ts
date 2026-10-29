import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  writeBatch,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  BLUEPRINT_LIMITS,
  VideoCategory,
  ReactionType,
  isValidVideoCategory,
  isValidReactionType,
  computeNextReactionState,
  buildDriveUrls,
  formatUploadNotificationMessage,
  sanitizeDisplayName,
  sanitizePhotoUrl,
} from '../utils/videoHubLogic';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

const provider = new GoogleAuthProvider();
SCOPES.forEach((scope) => provider.addScope(scope));

// In-memory access token cache (never stored in localStorage/sessionStorage)
let isSigningIn = false;
let cachedAccessToken: string | null = null;

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((p) => ({
          providerId: p.providerId,
          email: p.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Validate connection to Firestore on boot
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

export interface UserPublicProfile {
  uid: string;
  displayName: string;
  photoURL: string;
  followerCount: number;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface PublicVideoItem {
  videoId: string;
  title: string;
  description: string;
  category: VideoCategory;
  driveFileId: string;
  streamUrl: string;
  downloadUrl: string;
  uploaderId: string;
  uploaderName: string;
  uploaderPhoto: string;
  likeCount?: number;
  visibility: 'public';
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface UserNotificationItem {
  id: string;
  recipientId: string;
  senderId: string;
  senderName: string;
  senderPhoto: string;
  videoId: string;
  videoTitle: string;
  message: string;
  read: boolean;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export async function requestBrowserNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission;
  }
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export function triggerBrowserPushNotification(title: string, body: string, icon?: string) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    try {
      new Notification(title, {
        body,
        icon: icon || undefined,
        tag: `busnc-${Date.now()}`,
      });
    } catch (err) {
      console.warn('Browser notification dispatch failed:', err);
    }
  }
}

export async function ensureUserProfile(user: User): Promise<UserPublicProfile> {
  const userPath = `users/${user.uid}`;
  const privatePath = `users/${user.uid}/private/account`;
  const userRef = doc(db, 'users', user.uid);
  const privateRef = doc(db, 'users', user.uid, 'private', 'account');

  const safeName = sanitizeDisplayName(user.displayName);
  const safePhoto = sanitizePhotoUrl(user.photoURL);
  const safeEmail = (user.email || 'driver@busnc.app').slice(0, BLUEPRINT_LIMITS.EMAIL_MAX);

  try {
    const existingSnap = await getDoc(userRef);
    if (!existingSnap.exists()) {
      const batch = writeBatch(db);
      batch.set(userRef, {
        uid: user.uid,
        displayName: safeName,
        photoURL: safePhoto,
        followerCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(privateRef, {
        uid: user.uid,
        email: safeEmail,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      return {
        uid: user.uid,
        displayName: safeName,
        photoURL: safePhoto,
        followerCount: 0,
      };
    } else {
      const data = existingSnap.data() as UserPublicProfile;
      if (data.displayName !== safeName || data.photoURL !== safePhoto) {
        await updateDoc(userRef, {
          displayName: safeName,
          photoURL: safePhoto,
          updatedAt: serverTimestamp(),
        });
      }
      return {
        uid: data.uid,
        displayName: safeName,
        photoURL: safePhoto,
        followerCount: typeof data.followerCount === 'number' ? data.followerCount : 0,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      };
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `${userPath} & ${privatePath}`);
  }
}

export const initAuth = (
  onAuthChange: (user: User | null, hasDriveToken: boolean) => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      try {
        await ensureUserProfile(user);
      } catch (err) {
        console.error('Profile sync error:', err);
      }
      onAuthChange(user, Boolean(cachedAccessToken));
    } else {
      if (!isSigningIn) {
        cachedAccessToken = null;
      }
      onAuthChange(null, false);
    }
  });
};

export const googleSignIn = async (): Promise<{
  user: User;
  accessToken: string;
} | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to obtain Google Drive access token during sign-in.');
    }
    cachedAccessToken = credential.accessToken;

    // Immediately prompt browser Notification permission upon sign-in as required
    await requestBrowserNotificationPermission();

    await ensureUserProfile(result.user);
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = (): string | null => cachedAccessToken;

export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
};

export async function getCreatorProfile(userId: string): Promise<UserPublicProfile | null> {
  const path = `users/${userId}`;
  try {
    const snap = await getDoc(doc(db, 'users', userId));
    if (!snap.exists()) return null;
    return snap.data() as UserPublicProfile;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function checkIsFollowing(
  creatorId: string,
  followerId: string
): Promise<boolean> {
  if (!creatorId || !followerId || creatorId === followerId) return false;
  const path = `users/${creatorId}/followers/${followerId}`;
  try {
    const snap = await getDoc(doc(db, 'users', creatorId, 'followers', followerId));
    return snap.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function toggleFollowCreator(
  creatorId: string,
  currentUser: User,
  isCurrentlyFollowing: boolean
): Promise<boolean> {
  if (creatorId === currentUser.uid) {
    throw new Error('You cannot follow your own profile.');
  }

  const creatorPath = `users/${creatorId}`;
  const followerPath = `users/${creatorId}/followers/${currentUser.uid}`;
  const creatorRef = doc(db, 'users', creatorId);
  const followerRef = doc(db, 'users', creatorId, 'followers', currentUser.uid);

  try {
    const creatorSnap = await getDoc(creatorRef);
    if (!creatorSnap.exists()) {
      throw new Error('Creator profile not found.');
    }
    const currentCount = Number(creatorSnap.data().followerCount || 0);
    const batch = writeBatch(db);

    if (isCurrentlyFollowing) {
      const nextCount = Math.max(0, currentCount - 1);
      batch.delete(followerRef);
      batch.update(creatorRef, {
        followerCount: nextCount,
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      return false;
    } else {
      const nextCount = currentCount + 1;
      batch.set(followerRef, {
        creatorId,
        followerId: currentUser.uid,
        followerName: sanitizeDisplayName(currentUser.displayName),
        createdAt: serverTimestamp(),
      });
      batch.update(creatorRef, {
        followerCount: nextCount,
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      return true;
    }
  } catch (error) {
    handleFirestoreError(
      error,
      isCurrentlyFollowing ? OperationType.DELETE : OperationType.CREATE,
      followerPath || creatorPath
    );
  }
}

export interface UploadProgressState {
  percent: number;
  stage: 'uploading' | 'permissions' | 'saving' | 'notifying' | 'done';
  statusText: string;
}

function uploadFileMultipartToDrive(
  file: File,
  title: string,
  description: string,
  accessToken: string,
  onProgress: (percent: number) => void
): Promise<{ id: string }> {
  return new Promise((resolve, reject) => {
    const metadata = {
      name: `${title.trim()} - BusNC.mp4`,
      description: `No-Copyright Bus Gaming Video: ${description.trim()}`,
      mimeType: 'video/mp4',
    };

    const boundary = '-------BusNCDriveMultipartBoundary' + Date.now().toString(16);
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const metadataPart =
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      'Content-Type: video/mp4\r\n\r\n';

    const multipartBody = new Blob([
      metadataPart,
      file,
      closeDelimiter,
    ]);

    const xhr = new XMLHttpRequest();
    xhr.open(
      'POST',
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink',
      true
    );
    xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    xhr.setRequestHeader('Content-Type', `multipart/related; boundary=${boundary}`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        const pct = Math.min(99, Math.round((event.loaded / event.total) * 100));
        onProgress(pct);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const parsed = JSON.parse(xhr.responseText);
          if (parsed && parsed.id) {
            onProgress(100);
            resolve({ id: parsed.id });
          } else {
            reject(new Error('Google Drive did not return a file ID.'));
          }
        } catch {
          reject(new Error('Invalid response from Google Drive upload endpoint.'));
        }
      } else if (xhr.status === 401 || xhr.status === 403) {
        cachedAccessToken = null;
        reject(
          new Error(
            'Google Drive authorization expired or lacks permission. Please click "Reconnect Google Drive" and try again.'
          )
        );
      } else {
        reject(new Error(`Google Drive upload failed (HTTP ${xhr.status}).`));
      }
    };

    xhr.onerror = () => {
      reject(new Error('Network error while uploading MP4 to Google Drive.'));
    };

    xhr.send(multipartBody);
  });
}

async function makeDriveFilePublic(fileId: string, accessToken: string): Promise<void> {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        role: 'reader',
        type: 'anyone',
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(
      `Failed to set Google Drive public permission (HTTP ${response.status}): ${errText}`
    );
  }
}

export async function uploadVideoToDriveAndFirestore(params: {
  file: File;
  title: string;
  description: string;
  category: VideoCategory;
  user: User;
  onProgress: (state: UploadProgressState) => void;
}): Promise<PublicVideoItem> {
  const { file, title, description, category, user, onProgress } = params;
  const accessToken = getAccessToken();
  if (!accessToken) {
    throw new Error('Google Drive access token is required. Please connect Google Drive.');
  }

  await ensureUserProfile(user);

  onProgress({
    percent: 1,
    stage: 'uploading',
    statusText: 'Uploading MP4 to your Google Drive...',
  });

  const { id: driveFileId } = await uploadFileMultipartToDrive(
    file,
    title,
    description,
    accessToken,
    (pct) => {
      onProgress({
        percent: pct,
        stage: 'uploading',
        statusText: `Uploading MP4 to Google Drive (${pct}%)...`,
      });
    }
  );

  onProgress({
    percent: 100,
    stage: 'permissions',
    statusText: 'Setting Google Drive file permission to Public (Anyone with link)...',
  });

  await makeDriveFilePublic(driveFileId, accessToken);

  onProgress({
    percent: 100,
    stage: 'saving',
    statusText: 'Saving video metadata to Firestore public_videos...',
  });

  const videoId = `vid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const { streamUrl, downloadUrl } = buildDriveUrls(driveFileId, firebaseConfig.apiKey);
  const uploaderName = sanitizeDisplayName(user.displayName);
  const uploaderPhoto = sanitizePhotoUrl(user.photoURL);
  const cleanTitle = title.trim().slice(0, BLUEPRINT_LIMITS.TITLE_MAX);
  const cleanDesc = description.trim().slice(0, BLUEPRINT_LIMITS.DESCRIPTION_MAX);
  const cleanCategory: VideoCategory = isValidVideoCategory(category)
    ? category
    : 'Simulation';

  const videoRef = doc(db, 'public_videos', videoId);
  try {
    await setDoc(videoRef, {
      videoId,
      title: cleanTitle,
      description: cleanDesc,
      category: cleanCategory,
      driveFileId,
      streamUrl,
      downloadUrl,
      uploaderId: user.uid,
      uploaderName,
      uploaderPhoto,
      likeCount: 0,
      visibility: 'public',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `public_videos/${videoId}`);
  }

  // Trigger Notification on Upload for EVERY follower of this creator
  onProgress({
    percent: 100,
    stage: 'notifying',
    statusText: 'Dispatching real-time notifications to followers...',
  });

  const followersPath = `users/${user.uid}/followers`;
  try {
    const followersQuery = query(
      collection(db, 'users', user.uid, 'followers'),
      where('creatorId', '==', user.uid)
    );
    const followersSnap = await getDocs(followersQuery);

    if (!followersSnap.empty) {
      const notificationMessage = formatUploadNotificationMessage(uploaderName, cleanTitle);
      const followerDocs = followersSnap.docs;

      // Commit notifications in chunks of up to 400 per batch
      for (let i = 0; i < followerDocs.length; i += 400) {
        const chunk = followerDocs.slice(i, i + 400);
        const batch = writeBatch(db);
        chunk.forEach((fDoc) => {
          const followerId = fDoc.data().followerId as string;
          if (followerId && followerId !== user.uid) {
            const notifId = `notif_${videoId}_${followerId.slice(0, 12)}`;
            const notifRef = doc(db, 'users', followerId, 'notifications', notifId);
            batch.set(notifRef, {
              recipientId: followerId,
              senderId: user.uid,
              senderName: uploaderName,
              senderPhoto: uploaderPhoto,
              videoId,
              videoTitle: cleanTitle,
              message: notificationMessage,
              read: false,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        });
        await batch.commit();
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, followersPath);
  }

  onProgress({
    percent: 100,
    stage: 'done',
    statusText: 'Upload complete! Video is live and followers have been notified.',
  });

  return {
    videoId,
    title: cleanTitle,
    description: cleanDesc,
    category: cleanCategory,
    driveFileId,
    streamUrl,
    downloadUrl,
    uploaderId: user.uid,
    uploaderName,
    uploaderPhoto,
    likeCount: 0,
    visibility: 'public',
  };
}

export async function getUserVideoReaction(
  videoId: string,
  userId: string
): Promise<ReactionType | null> {
  if (!videoId || !userId) return null;
  const path = `public_videos/${videoId}/likes/${userId}`;
  try {
    const snap = await getDoc(doc(db, 'public_videos', videoId, 'likes', userId));
    if (!snap.exists()) return null;
    const rType = snap.data().reactionType;
    return isValidReactionType(rType) ? rType : 'like';
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function toggleVideoReaction(
  videoId: string,
  currentUser: User,
  clickedReaction: ReactionType,
  currentReaction: ReactionType | null
): Promise<ReactionType | null> {
  const videoPath = `public_videos/${videoId}`;
  const likePath = `public_videos/${videoId}/likes/${currentUser.uid}`;
  const videoRef = doc(db, 'public_videos', videoId);
  const likeRef = doc(db, 'public_videos', videoId, 'likes', currentUser.uid);

  try {
    const videoSnap = await getDoc(videoRef);
    if (!videoSnap.exists()) {
      throw new Error('Video not found.');
    }

    const currentCount = Number(videoSnap.data().likeCount || 0);
    const { nextReaction, nextLikeCount, operation } = computeNextReactionState(
      currentReaction,
      clickedReaction,
      currentCount
    );

    if (operation === 'create') {
      const batch = writeBatch(db);
      batch.set(likeRef, {
        videoId,
        userId: currentUser.uid,
        reactionType: clickedReaction,
        createdAt: serverTimestamp(),
      });
      batch.update(videoRef, {
        likeCount: nextLikeCount,
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      return nextReaction;
    } else if (operation === 'delete') {
      const batch = writeBatch(db);
      batch.delete(likeRef);
      batch.update(videoRef, {
        likeCount: nextLikeCount,
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      return null;
    } else {
      await updateDoc(likeRef, {
        reactionType: clickedReaction,
      });
      return nextReaction;
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `${likePath} & ${videoPath}`);
  }
}

export async function deleteVideoFromHubAndDrive(
  video: PublicVideoItem,
  deleteFromDrive: boolean
): Promise<void> {
  if (deleteFromDrive && cachedAccessToken) {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(video.driveFileId)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${cachedAccessToken}` },
      }
    );
    if (!res.ok && res.status !== 404) {
      throw new Error(`Failed to remove file from Google Drive (HTTP ${res.status}).`);
    }
  }

  const videoPath = `public_videos/${video.videoId}`;
  try {
    await deleteDoc(doc(db, 'public_videos', video.videoId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, videoPath);
  }
}

export async function markNotificationAsRead(
  userId: string,
  notificationId: string
): Promise<void> {
  const path = `users/${userId}/notifications/${notificationId}`;
  try {
    await updateDoc(doc(db, 'users', userId, 'notifications', notificationId), {
      read: true,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function markAllNotificationsAsRead(
  userId: string,
  unreadNotifications: UserNotificationItem[]
): Promise<void> {
  if (unreadNotifications.length === 0) return;
  const path = `users/${userId}/notifications`;
  try {
    const batch = writeBatch(db);
    unreadNotifications.slice(0, 400).forEach((item) => {
      const ref = doc(db, 'users', userId, 'notifications', item.id);
      batch.update(ref, {
        read: true,
        updatedAt: serverTimestamp(),
      });
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}
