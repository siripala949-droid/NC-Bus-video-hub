/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import {
  Bell,
  Home,
  PlusSquare,
  User as UserIcon,
  Search,
  Video,
  LogOut,
  AlertTriangle,
} from 'lucide-react';
import {
  db,
  initAuth,
  googleSignIn,
  logout,
  PublicVideoItem,
  UserNotificationItem,
  requestBrowserNotificationPermission,
  triggerBrowserPushNotification,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteVideoFromHubAndDrive,
  handleFirestoreError,
  OperationType,
} from './services/firebase';
import { VideoCard } from './components/VideoCard';
import { UploadView } from './components/UploadView';
import { CreatorProfileView } from './components/CreatorProfileView';
import { NotificationDrawer } from './components/NotificationDrawer';
import { GoogleSignInButton } from './components/GoogleSignInButton';
import {
  VIDEO_CATEGORIES,
  filterVideosByCategoryAndQuery,
} from './utils/videoHubLogic';

type ActiveTab = 'home' | 'upload' | 'profile';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('home');
  const [selectedCreatorId, setSelectedCreatorId] = useState<string | null>(null);

  // Auth & OAuth Drive state
  const [user, setUser] = useState<User | null>(null);
  const [hasDriveToken, setHasDriveToken] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Real-time Firestore data (strictly empty until fetched from Firebase)
  const [videos, setVideos] = useState<PublicVideoItem[]>([]);
  const [loadingVideos, setLoadingVideos] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');

  // Notifications state
  const [notifications, setNotifications] = useState<UserNotificationItem[]>([]);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [browserPermission, setBrowserPermission] = useState<
    NotificationPermission | 'unsupported'
  >(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'unsupported';
    }
    return Notification.permission;
  });

  // Delete confirmation modal state
  const [videoToDelete, setVideoToDelete] = useState<PublicVideoItem | null>(null);
  const [alsoDeleteFromDrive, setAlsoDeleteFromDrive] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Track initial notification snapshot so only real-time new arrivals trigger browser push
  const initialNotifSnapDoneRef = useRef(false);
  const seenNotifIdsRef = useRef<Set<string>>(new Set());

  // 1. Initialize Firebase Auth listener
  useEffect(() => {
    const unsub = initAuth((firebaseUser, driveReady) => {
      setUser(firebaseUser);
      setHasDriveToken(driveReady);
      setAuthReady(true);
      if (typeof window !== 'undefined' && 'Notification' in window) {
        setBrowserPermission(Notification.permission);
      }
    });
    return () => unsub();
  }, []);

  // 2. Real-time Firestore listener for public_videos (Zero Mock Data)
  useEffect(() => {
    setLoadingVideos(true);
    const videosPath = 'public_videos';
    const q = query(
      collection(db, 'public_videos'),
      where('visibility', '==', 'public')
    );

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const items: PublicVideoItem[] = snapshot.docs.map(
          (docSnap) => docSnap.data() as PublicVideoItem
        );
        items.sort((a, b) => {
          const tA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
          const tB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
          return tB - tA;
        });
        setVideos(items);
        setLoadingVideos(false);
      },
      (error) => {
        setLoadingVideos(false);
        handleFirestoreError(error, OperationType.LIST, videosPath);
      }
    );

    return () => unsub();
  }, []);

  // 3. Real-time Firestore listener for signed-in user's notifications + Browser Push
  useEffect(() => {
    if (!authReady || !user) {
      setNotifications([]);
      initialNotifSnapDoneRef.current = false;
      seenNotifIdsRef.current.clear();
      return;
    }

    const notifPath = `users/${user.uid}/notifications`;
    const q = query(
      collection(db, 'users', user.uid, 'notifications'),
      where('recipientId', '==', user.uid)
    );

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          const docId = change.doc.id;
          const data = change.doc.data() as Omit<UserNotificationItem, 'id'>;
          if (change.type === 'added') {
            if (
              initialNotifSnapDoneRef.current &&
              !seenNotifIdsRef.current.has(docId) &&
              !data.read
            ) {
              triggerBrowserPushNotification(
                `New Bus Video from ${data.senderName}`,
                data.message,
                data.senderPhoto || undefined
              );
            }
            seenNotifIdsRef.current.add(docId);
          }
        });

        initialNotifSnapDoneRef.current = true;

        const list: UserNotificationItem[] = snapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<UserNotificationItem, 'id'>),
        }));

        list.sort((a, b) => {
          const tA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
          const tB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
          return tB - tA;
        });

        setNotifications(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, notifPath);
      }
    );

    return () => unsub();
  }, [authReady, user]);

  const handleGoogleLogin = async () => {
    setAuthError(null);
    setIsSigningIn(true);
    try {
      const result = await googleSignIn();
      if (result) {
        setUser(result.user);
        setHasDriveToken(true);
        if (typeof window !== 'undefined' && 'Notification' in window) {
          setBrowserPermission(Notification.permission);
        }
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Sign-in cancelled or failed.';
      setAuthError(message);
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleRequestBrowserPermission = async () => {
    const perm = await requestBrowserNotificationPermission();
    setBrowserPermission(perm);
  };

  const handleOpenCreatorProfile = (creatorId: string) => {
    setSelectedCreatorId(creatorId);
    setActiveTab('profile');
  };

  const handleSwitchTab = (tab: ActiveTab) => {
    if (tab === 'profile') {
      setSelectedCreatorId(user?.uid || null);
    }
    setActiveTab(tab);
  };

  const handleConfirmDeleteVideo = async () => {
    if (!videoToDelete) return;
    setIsDeleting(true);
    try {
      await deleteVideoFromHubAndDrive(videoToDelete, alsoDeleteFromDrive);
      setVideoToDelete(null);
      setAlsoDeleteFromDrive(false);
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Failed to delete video.'
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  const filteredVideos = filterVideosByCategoryAndQuery(
    videos,
    selectedCategory,
    searchQuery
  );

  return (
    <div className="min-h-screen bg-[#090B10] text-slate-100 flex flex-col pb-20 md:pb-12">
      {/* Top Bar Contract: 3 Zones (Wordmark | Nav Links | Primary Action & Notification Bell) */}
      <header className="sticky top-0 z-30 h-14 bg-[#090B10]/95 backdrop-blur-md border-b border-slate-800/90 px-4 sm:px-6 flex items-center justify-between gap-4 sm:gap-8">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#home"
          onClick={(e) => {
            e.preventDefault();
            handleSwitchTab('home');
          }}
          className="text-xl font-display font-bold tracking-wider text-amber-400 whitespace-nowrap shrink-0"
        >
          BusNC Hub
        </a>

        {/* Zone 2: Clean single-line text navigation links */}
        <nav
          aria-label="Primary Navigation"
          className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-300"
        >
          <button
            type="button"
            onClick={() => handleSwitchTab('home')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
              activeTab === 'home'
                ? 'text-amber-400 border-amber-400'
                : 'border-transparent hover:text-slate-100'
            }`}
          >
            Home
          </button>
          <button
            type="button"
            onClick={() => handleSwitchTab('upload')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
              activeTab === 'upload'
                ? 'text-amber-400 border-amber-400'
                : 'border-transparent hover:text-slate-100'
            }`}
          >
            Upload (+)
          </button>
          <button
            type="button"
            onClick={() => handleSwitchTab('profile')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
              activeTab === 'profile'
                ? 'text-amber-400 border-amber-400'
                : 'border-transparent hover:text-slate-100'
            }`}
          >
            My Profile
          </button>
        </nav>

        {/* Zone 3: Notification Bell & Auth CTA */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setIsNotifOpen(true)}
            aria-label={`Notifications (${unreadCount} unread)`}
            className="relative min-h-[40px] min-w-[40px] rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 flex items-center justify-center text-slate-200 transition-colors cursor-pointer"
          >
            <Bell className="w-4 h-4 text-amber-400" />
            {unreadCount > 0 && (
              <span
                data-testid="unread-notification-badge"
                className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-mono tabular-nums font-bold flex items-center justify-center"
              >
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {!user ? (
            <GoogleSignInButton
              onClick={handleGoogleLogin}
              disabled={isSigningIn}
              label="Sign in"
            />
          ) : (
            <button
              type="button"
              onClick={logout}
              aria-label="Sign out"
              className="min-h-[40px] px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-semibold text-slate-200 flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5 text-slate-400" />
              <span>Sign Out</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-7 space-y-5">
        {authError && (
          <div
            role="alert"
            className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs flex items-center justify-between gap-3"
          >
            <span>{authError}</span>
            <button
              type="button"
              onClick={() => setAuthError(null)}
              className="text-rose-300 hover:text-white font-semibold underline shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* HOME TAB */}
        {activeTab === 'home' && (
          <div className="space-y-5">
            {/* Compact Mobile-First Header & Filter Bar */}
            <div className="bg-[#111520] border border-slate-800/80 rounded-2xl p-4 sm:p-5 space-y-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-baseline gap-2.5 min-w-0">
                  <h1 className="text-xl sm:text-2xl font-display font-bold tracking-wide text-slate-100 truncate">
                    Bus Gaming Videos
                  </h1>
                  <span className="text-xs font-mono tabular-nums text-amber-400 shrink-0">
                    · {filteredVideos.length} {filteredVideos.length === 1 ? 'Clip' : 'Clips'}
                  </span>
                </div>
                <span className="hidden sm:inline text-xs text-slate-400 shrink-0">
                  No-Copyright Community Hub
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-2.5">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    aria-label="Search bus gaming videos"
                    placeholder="Search videos or creators..."
                    className="w-full h-11 pl-10 pr-4 rounded-xl bg-slate-900 border border-slate-800 text-xs sm:text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <select
                  id="home-category-filter"
                  aria-label="Filter videos by category"
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="h-11 px-3.5 rounded-xl bg-slate-900 border border-slate-800 text-xs sm:text-sm font-semibold text-slate-200 focus:outline-none focus:border-amber-500 cursor-pointer"
                >
                  <option value="All" className="bg-slate-900 text-slate-100">
                    All Categories
                  </option>
                  {VIDEO_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat} className="bg-slate-900 text-slate-100">
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Video Feed or Clean Empty State */}
            {loadingVideos ? (
              <div className="bg-[#111520] border border-slate-800/80 rounded-2xl p-10 text-center space-y-2">
                <p className="text-sm font-semibold text-slate-200">
                  Loading videos...
                </p>
              </div>
            ) : filteredVideos.length === 0 ? (
              <div
                data-testid="empty-feed-state"
                className="bg-[#111520] border border-slate-800/80 rounded-2xl p-8 sm:p-12 text-center"
              >
                <div className="max-w-md mx-auto space-y-4">
                  <div className="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto text-amber-400">
                    <Video className="w-6 h-6" />
                  </div>
                  <div className="space-y-1.5">
                    <h2 className="text-xl font-display font-bold tracking-wide text-slate-100">
                      {searchQuery.trim() || selectedCategory !== 'All'
                        ? 'No Matching Videos Found'
                        : 'No Videos Uploaded Yet'}
                    </h2>
                    <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                      {searchQuery.trim() || selectedCategory !== 'All'
                        ? `No videos found for ${
                            selectedCategory !== 'All'
                              ? `"${selectedCategory}"`
                              : 'your search'
                          }. Reset filters or upload a new clip.`
                        : 'Share the first no-copyright bus gaming video with the community.'}
                    </p>
                  </div>
                  <div className="pt-1 flex flex-wrap items-center justify-center gap-2.5">
                    {(searchQuery.trim() || selectedCategory !== 'All') && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCategory('All');
                          setSearchQuery('');
                        }}
                        className="min-h-[44px] px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs sm:text-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Reset Filters
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleSwitchTab('upload')}
                      className="min-h-[44px] px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs sm:text-sm inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <PlusSquare className="w-4 h-4" />
                      <span>Upload Video</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {filteredVideos.map((video) => (
                  <VideoCard
                    key={video.videoId}
                    video={video}
                    currentUser={user}
                    onRequireLogin={handleGoogleLogin}
                    onSelectCreator={handleOpenCreatorProfile}
                    onRequestDelete={(vid) => {
                      setVideoToDelete(vid);
                      setAlsoDeleteFromDrive(false);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* UPLOAD TAB */}
        {activeTab === 'upload' && (
          <UploadView
            user={user}
            hasDriveToken={hasDriveToken}
            isSigningIn={isSigningIn}
            onLogin={handleGoogleLogin}
            onUploadComplete={() => {
              handleSwitchTab('home');
            }}
          />
        )}

        {/* CREATOR / MY PROFILE TAB */}
        {activeTab === 'profile' && (
          <CreatorProfileView
            targetCreatorId={selectedCreatorId}
            currentUser={user}
            isSigningIn={isSigningIn}
            onLogin={handleGoogleLogin}
            allVideos={videos}
            onBackToFeed={() => handleSwitchTab('home')}
            onSelectCreator={handleOpenCreatorProfile}
            onRequestDeleteVideo={(vid) => {
              setVideoToDelete(vid);
              setAlsoDeleteFromDrive(false);
            }}
            onSwitchToUpload={() => handleSwitchTab('upload')}
          />
        )}
      </main>

      {/* Mobile Fixed Bottom Navigation Bar (Natural Thumb Zone, <= 15% Viewport Cap) */}
      <nav
        aria-label="Mobile Bottom Navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-14 bg-[#111520]/95 backdrop-blur-md border-t border-slate-800 grid grid-cols-3 items-center"
      >
        <button
          type="button"
          onClick={() => handleSwitchTab('home')}
          className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 transition-colors cursor-pointer ${
            activeTab === 'home' ? 'text-amber-400' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Home className="w-5 h-5" />
          <span className="text-[10px] font-semibold tracking-tight whitespace-nowrap">
            Home
          </span>
        </button>

        <button
          type="button"
          onClick={() => handleSwitchTab('upload')}
          className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 transition-colors cursor-pointer ${
            activeTab === 'upload' ? 'text-amber-400' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <PlusSquare className="w-5 h-5" />
          <span className="text-[10px] font-semibold tracking-tight whitespace-nowrap">
            Upload (+)
          </span>
        </button>

        <button
          type="button"
          onClick={() => handleSwitchTab('profile')}
          className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 transition-colors cursor-pointer ${
            activeTab === 'profile' ? 'text-amber-400' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <UserIcon className="w-5 h-5" />
          <span className="text-[10px] font-semibold tracking-tight whitespace-nowrap">
            My Profile
          </span>
        </button>
      </nav>

      {/* Real-Time Notification Drawer */}
      <NotificationDrawer
        isOpen={isNotifOpen}
        onClose={() => setIsNotifOpen(false)}
        notifications={notifications}
        isSignedIn={Boolean(user)}
        browserPermission={browserPermission}
        onRequestBrowserPermission={handleRequestBrowserPermission}
        onMarkAsRead={(item) => {
          if (user) {
            markNotificationAsRead(user.uid, item.id);
          }
        }}
        onMarkAllRead={() => {
          if (user) {
            const unread = notifications.filter((n) => !n.read);
            markAllNotificationsAsRead(user.uid, unread);
          }
        }}
        onSelectCreatorFromNotification={(creatorId) => {
          handleOpenCreatorProfile(creatorId);
        }}
      />

      {/* Mandatory User Confirmation Dialog for Deleting Video */}
      {videoToDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm Video Deletion"
        >
          <div className="w-full max-w-md bg-[#111520] border border-slate-800 rounded-2xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h2 className="text-lg font-display font-bold text-slate-100">
                  Delete Video?
                </h2>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Are you sure you want to remove{' '}
                  <strong className="text-slate-200">"{videoToDelete.title}"</strong> from
                  the hub?
                </p>
              </div>
            </div>

            {hasDriveToken && (
              <label className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={alsoDeleteFromDrive}
                  onChange={(e) => setAlsoDeleteFromDrive(e.target.checked)}
                  className="rounded border-slate-700"
                />
                <span>Also delete the video file from my Google Drive</span>
              </label>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setVideoToDelete(null)}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDeleteVideo}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-rose-500 hover:bg-rose-400 text-xs font-semibold text-white transition-colors"
              >
                {isDeleting ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
