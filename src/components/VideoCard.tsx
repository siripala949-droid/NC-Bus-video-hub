import React, { useEffect, useState } from 'react';
import { User } from 'firebase/auth';
import {
  Download,
  Trash2,
  User as UserIcon,
  ThumbsUp,
  Flame,
  Trophy,
} from 'lucide-react';
import {
  PublicVideoItem,
  getUserVideoReaction,
  toggleVideoReaction,
} from '../services/firebase';
import { buildDriveUrls, ReactionType } from '../utils/videoHubLogic';

interface VideoCardProps {
  video: PublicVideoItem;
  currentUser?: User | null;
  onRequireLogin?: () => Promise<void>;
  onSelectCreator: (creatorId: string) => void;
  onRequestDelete?: (video: PublicVideoItem) => void;
}

const REACTION_OPTIONS: {
  type: ReactionType;
  label: string;
  Icon: React.FC<{ className?: string }>;
}[] = [
  { type: 'like', label: 'Like', Icon: ThumbsUp },
  { type: 'fire', label: 'Fire', Icon: Flame },
  { type: 'trophy', label: 'Top Clip', Icon: Trophy },
];

export const VideoCard: React.FC<VideoCardProps> = ({
  video,
  currentUser,
  onRequireLogin,
  onSelectCreator,
  onRequestDelete,
}) => {
  const [useEmbedFallback, setUseEmbedFallback] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [userReaction, setUserReaction] = useState<ReactionType | null>(null);
  const [reactionBusy, setReactionBusy] = useState(false);

  const { embedPreviewUrl } = buildDriveUrls(video.driveFileId);
  const isOwner = Boolean(currentUser && currentUser.uid === video.uploaderId);
  const totalLikes = Math.max(0, Number(video.likeCount || 0));

  useEffect(() => {
    let active = true;
    if (!currentUser?.uid) {
      setUserReaction(null);
      return;
    }
    getUserVideoReaction(video.videoId, currentUser.uid)
      .then((res) => {
        if (active) setUserReaction(res);
      })
      .catch(() => {
        if (active) setUserReaction(null);
      });
    return () => {
      active = false;
    };
  }, [video.videoId, currentUser?.uid]);

  const handleReactionClick = async (reactionType: ReactionType) => {
    if (!currentUser) {
      if (onRequireLogin) {
        await onRequireLogin();
      }
      return;
    }
    if (reactionBusy) return;
    setReactionBusy(true);
    try {
      const next = await toggleVideoReaction(
        video.videoId,
        currentUser,
        reactionType,
        userReaction
      );
      setUserReaction(next);
    } catch (err) {
      console.error('Reaction update failed:', err);
    } finally {
      setReactionBusy(false);
    }
  };

  const formattedDate = video.createdAt?.toDate
    ? video.createdAt.toDate().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : 'Just now';

  return (
    <article
      className="bg-[#111520] border border-slate-800/80 rounded-2xl overflow-hidden flex flex-col transition-transform duration-150"
      data-testid={`video-card-${video.videoId}`}
    >
      {/* Video Player Surface */}
      <div className="relative aspect-video bg-black w-full overflow-hidden">
        {!useEmbedFallback ? (
          <video
            src={video.streamUrl}
            controls
            playsInline
            preload="metadata"
            onError={() => setUseEmbedFallback(true)}
            className="w-full h-full object-contain bg-black"
          >
            Your browser does not support HTML5 video playback.
          </video>
        ) : (
          <iframe
            src={embedPreviewUrl}
            title={video.title}
            allow="autoplay; fullscreen"
            className="w-full h-full border-0 bg-black"
          />
        )}
      </div>

      {/* Video Metadata & Controls */}
      <div className="p-4 sm:p-5 flex-1 flex flex-col justify-between gap-4">
        <div className="space-y-2.5">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-base sm:text-lg font-semibold text-slate-100 leading-snug line-clamp-2">
              {video.title}
            </h3>
            {isOwner && onRequestDelete && (
              <button
                type="button"
                onClick={() => onRequestDelete(video)}
                aria-label={`Delete video ${video.title}`}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors shrink-0"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Unboxed Metadata Line (Zero-Pill Discipline) */}
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span className="text-amber-400 font-semibold">
              {video.category || 'Simulation'}
            </span>
            <span aria-hidden="true">·</span>
            <span>No-Copyright</span>
            <span aria-hidden="true">·</span>
            <span>{formattedDate}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-slate-300">
              {totalLikes} {totalLikes === 1 ? 'Reaction' : 'Reactions'}
            </span>
          </div>

          <p className="text-sm text-slate-300 leading-relaxed line-clamp-3">
            {video.description}
          </p>
        </div>

        <div className="space-y-3 pt-2">
          {/* Appreciation Reaction Bar */}
          <div
            className="flex items-center justify-between gap-2 p-1.5 rounded-xl bg-slate-900/90 border border-slate-800/80"
            role="group"
            aria-label={`Reactions for ${video.title}`}
          >
            <div className="flex items-center gap-1">
              {REACTION_OPTIONS.map(({ type, label, Icon }) => {
                const isSelected = userReaction === type;
                return (
                  <button
                    key={type}
                    type="button"
                    disabled={reactionBusy}
                    onClick={() => handleReactionClick(type)}
                    aria-pressed={isSelected}
                    aria-label={`${label} video ${video.title}`}
                    className={`min-h-[36px] px-2.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      isSelected
                        ? 'bg-amber-500 text-slate-950'
                        : 'text-slate-300 hover:text-slate-100 hover:bg-slate-800'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>

            <span
              data-testid={`video-like-count-${video.videoId}`}
              className="px-2.5 text-xs font-mono tabular-nums font-semibold text-amber-400 shrink-0"
            >
              {totalLikes}
            </span>
          </div>

          {/* Footer: Uploader Profile Link & Direct Download Action */}
          <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => onSelectCreator(video.uploaderId)}
              className="min-h-[44px] flex items-center gap-2.5 text-left group focus-visible:outline-2 focus-visible:outline-amber-400 rounded-lg pr-2 cursor-pointer"
              aria-label={`View creator profile of ${video.uploaderName}`}
            >
              {video.uploaderPhoto && !avatarFailed ? (
                <img
                  src={video.uploaderPhoto}
                  alt={video.uploaderName}
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarFailed(true)}
                  className="w-9 h-9 rounded-full object-cover border border-slate-700 shrink-0"
                />
              ) : (
                <div className="w-9 h-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-amber-400 shrink-0">
                  <UserIcon className="w-4 h-4" />
                </div>
              )}
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-100 group-hover:text-amber-400 transition-colors truncate max-w-[140px]">
                  {video.uploaderName}
                </div>
                <div className="text-[11px] text-slate-400">View Creator</div>
              </div>
            </button>

            <div className="flex items-center gap-2 shrink-0">
              <a
                href={video.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                download
                aria-label={`Download ${video.title} MP4`}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-4 h-4" />
                <span>Download MP4</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
};
