import React, { useEffect, useState } from 'react';
import { User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { UserPlus, UserCheck, ArrowLeft, Video, User as UserIcon } from 'lucide-react';
import {
  db,
  PublicVideoItem,
  UserPublicProfile,
  checkIsFollowing,
  toggleFollowCreator,
  handleFirestoreError,
  OperationType,
} from '../services/firebase';
import { VideoCard } from './VideoCard';
import { GoogleSignInButton } from './GoogleSignInButton';

interface CreatorProfileViewProps {
  targetCreatorId: string | null;
  currentUser: User | null;
  isSigningIn: boolean;
  onLogin: () => Promise<void>;
  allVideos: PublicVideoItem[];
  onBackToFeed?: () => void;
  onSelectCreator: (creatorId: string) => void;
  onRequestDeleteVideo: (video: PublicVideoItem) => void;
  onSwitchToUpload: () => void;
}

export const CreatorProfileView: React.FC<CreatorProfileViewProps> = ({
  targetCreatorId,
  currentUser,
  isSigningIn,
  onLogin,
  allVideos,
  onBackToFeed,
  onSelectCreator,
  onRequestDeleteVideo,
  onSwitchToUpload,
}) => {
  const [profile, setProfile] = useState<UserPublicProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [followError, setFollowError] = useState<string | null>(null);
  const [avatarBroken, setAvatarBroken] = useState(false);

  const effectiveCreatorId = targetCreatorId || currentUser?.uid || null;
  const isOwnProfile = Boolean(
    currentUser && effectiveCreatorId && currentUser.uid === effectiveCreatorId
  );

  // Real-time listener on the creator's public profile document
  useEffect(() => {
    if (!effectiveCreatorId) {
      setProfile(null);
      return;
    }

    setLoadingProfile(true);
    setAvatarBroken(false);
    const path = `users/${effectiveCreatorId}`;
    const unsub = onSnapshot(
      doc(db, 'users', effectiveCreatorId),
      (snap) => {
        setLoadingProfile(false);
        if (snap.exists()) {
          setProfile(snap.data() as UserPublicProfile);
        } else if (isOwnProfile && currentUser) {
          setProfile({
            uid: currentUser.uid,
            displayName: currentUser.displayName || 'Bus Creator',
            photoURL: currentUser.photoURL || '',
            followerCount: 0,
          });
        } else {
          setProfile(null);
        }
      },
      (err) => {
        setLoadingProfile(false);
        handleFirestoreError(err, OperationType.GET, path);
      }
    );

    return () => unsub();
  }, [effectiveCreatorId, isOwnProfile, currentUser]);

  // Check whether current user follows this creator
  useEffect(() => {
    let active = true;
    if (!currentUser || !effectiveCreatorId || currentUser.uid === effectiveCreatorId) {
      setIsFollowing(false);
      return;
    }

    checkIsFollowing(effectiveCreatorId, currentUser.uid)
      .then((res) => {
        if (active) setIsFollowing(res);
      })
      .catch(() => {
        if (active) setIsFollowing(false);
      });

    return () => {
      active = false;
    };
  }, [currentUser, effectiveCreatorId]);

  const handleFollowToggle = async () => {
    setFollowError(null);
    if (!currentUser) {
      await onLogin();
      return;
    }
    if (!effectiveCreatorId || isOwnProfile) return;

    setFollowBusy(true);
    try {
      const nextState = await toggleFollowCreator(
        effectiveCreatorId,
        currentUser,
        isFollowing
      );
      setIsFollowing(nextState);
    } catch (err) {
      setFollowError(err instanceof Error ? err.message : 'Unable to update follow status.');
    } finally {
      setFollowBusy(false);
    }
  };

  // If user clicked "My Profile" while signed out
  if (!effectiveCreatorId) {
    return (
      <div className="max-w-xl mx-auto bg-[#111520] border border-slate-800/80 rounded-2xl p-8 text-center space-y-5">
        <div className="w-16 h-16 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto text-amber-400">
          <UserIcon className="w-7 h-7" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-display font-bold tracking-wide text-slate-100">
            Creator Profile & Channel
          </h1>
          <p className="text-sm text-slate-400 max-w-md mx-auto">
            Sign in with Google to create your Bus Gaming Creator Profile, track your follower count, and manage your uploaded no-copyright MP4 videos.
          </p>
        </div>
        <div className="flex justify-center pt-1">
          <GoogleSignInButton onClick={onLogin} disabled={isSigningIn} />
        </div>
      </div>
    );
  }

  const creatorVideos = allVideos.filter((v) => v.uploaderId === effectiveCreatorId);
  const displayName =
    profile?.displayName ||
    creatorVideos[0]?.uploaderName ||
    (isOwnProfile ? currentUser?.displayName : null) ||
    'Bus Creator';
  const photoURL =
    profile?.photoURL ||
    creatorVideos[0]?.uploaderPhoto ||
    (isOwnProfile ? currentUser?.photoURL : '') ||
    '';
  const followerCount = profile?.followerCount ?? 0;

  return (
    <div className="space-y-6">
      {onBackToFeed && !isOwnProfile && (
        <button
          type="button"
          onClick={onBackToFeed}
          className="min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:text-slate-100 hover:bg-slate-800/60 inline-flex items-center gap-2 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Video Feed</span>
        </button>
      )}

      {/* Creator Header Card */}
      <section className="bg-[#111520] border border-slate-800/80 rounded-2xl p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div className="flex items-center gap-4 sm:gap-5">
          {photoURL && !avatarBroken ? (
            <img
              src={photoURL}
              alt={displayName}
              referrerPolicy="no-referrer"
              onError={() => setAvatarBroken(true)}
              className="w-16 h-16 sm:w-20 sm:h-20 rounded-full object-cover border-2 border-amber-500/60 shrink-0"
            />
          ) : (
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-slate-900 border-2 border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
              <UserIcon className="w-8 h-8" />
            </div>
          )}

          <div className="space-y-1.5">
            <h1 className="text-2xl sm:text-3xl font-display font-bold tracking-wide text-slate-100">
              {loadingProfile ? 'Loading Creator...' : displayName}
            </h1>

            {/* Unboxed Metrics Line with Tabular Numerals */}
            <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-slate-400">
              <span>
                <strong className="font-mono tabular-nums text-slate-100">
                  {followerCount}
                </strong>{' '}
                {followerCount === 1 ? 'Follower' : 'Followers'}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                <strong className="font-mono tabular-nums text-slate-100">
                  {creatorVideos.length}
                </strong>{' '}
                {creatorVideos.length === 1 ? 'Uploaded Video' : 'Uploaded Videos'}
              </span>
              {isOwnProfile && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-amber-400">Your Creator Channel</span>
                </>
              )}
            </div>

            {followError && (
              <p className="text-xs text-rose-400 pt-1">{followError}</p>
            )}
          </div>
        </div>

        {/* Follow / Upload Action */}
        <div className="shrink-0">
          {!isOwnProfile ? (
            <button
              type="button"
              onClick={handleFollowToggle}
              disabled={followBusy}
              className={`min-h-[44px] px-5 py-2.5 rounded-xl font-semibold text-xs sm:text-sm inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                isFollowing
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700'
                  : 'bg-amber-500 hover:bg-amber-400 text-slate-950'
              }`}
            >
              {isFollowing ? (
                <>
                  <UserCheck className="w-4 h-4" />
                  <span>Following</span>
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4" />
                  <span>Follow Creator</span>
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={onSwitchToUpload}
              className="min-h-[44px] px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs sm:text-sm inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Video className="w-4 h-4" />
              <span>Upload New MP4</span>
            </button>
          )}
        </div>
      </section>

      {/* Uploaded Videos Grid */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-display font-bold tracking-wide text-slate-100">
            Uploaded No-Copyright Videos
          </h2>
          <span className="text-xs font-mono tabular-nums text-slate-400">
            {creatorVideos.length} total
          </span>
        </div>

        {creatorVideos.length === 0 ? (
          <div className="bg-[#111520] border border-slate-800/80 rounded-2xl p-10 text-center space-y-2">
            <Video className="w-8 h-8 text-slate-600 mx-auto" />
            <p className="text-sm font-semibold text-slate-200">
              No videos uploaded by {displayName} yet
            </p>
            <p className="text-xs text-slate-400">
              {isOwnProfile
                ? 'Publish your first MP4 clip via Google Drive to populate your creator grid.'
                : 'Follow this creator to get notified the moment they upload a new bus gaming video.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {creatorVideos.map((vid) => (
              <VideoCard
                key={vid.videoId}
                video={vid}
                currentUser={currentUser}
                onRequireLogin={onLogin}
                onSelectCreator={onSelectCreator}
                onRequestDelete={onRequestDeleteVideo}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
