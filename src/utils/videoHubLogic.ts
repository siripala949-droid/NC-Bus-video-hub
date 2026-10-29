/**
 * Pure domain logic, validation constraints (matching firebase-blueprint.json),
 * Google Drive URL builders, reaction helpers, and notification formatters.
 */

export const VIDEO_CATEGORIES = [
  'Simulation',
  'Racing',
  'Documentary',
  'Gameplay',
] as const;

export type VideoCategory = (typeof VIDEO_CATEGORIES)[number];

export const REACTION_TYPES = ['like', 'fire', 'trophy'] as const;

export type ReactionType = (typeof REACTION_TYPES)[number];

export const BLUEPRINT_LIMITS = {
  ID_MIN: 1,
  ID_MAX: 128,
  ID_PATTERN: /^[a-zA-Z0-9_\-]+$/,
  DISPLAY_NAME_MIN: 1,
  DISPLAY_NAME_MAX: 100,
  PHOTO_URL_MAX: 500,
  EMAIL_MIN: 3,
  EMAIL_MAX: 254,
  TITLE_MIN: 1,
  TITLE_MAX: 120,
  DESCRIPTION_MIN: 1,
  DESCRIPTION_MAX: 1000,
  CATEGORY_MAX: 32,
  REACTION_MAX: 16,
  URL_MAX: 500,
  NOTIFICATION_MESSAGE_MAX: 300,
} as const;

export interface VideoFormValidationResult {
  valid: boolean;
  error?: string;
  sanitizedTitle: string;
  sanitizedDescription: string;
  sanitizedCategory: VideoCategory;
}

export function isValidBlueprintId(id: string): boolean {
  return (
    typeof id === 'string' &&
    id.length >= BLUEPRINT_LIMITS.ID_MIN &&
    id.length <= BLUEPRINT_LIMITS.ID_MAX &&
    BLUEPRINT_LIMITS.ID_PATTERN.test(id)
  );
}

export function isValidVideoCategory(category: unknown): category is VideoCategory {
  return (
    typeof category === 'string' &&
    (VIDEO_CATEGORIES as readonly string[]).includes(category)
  );
}

export function isValidReactionType(reaction: unknown): reaction is ReactionType {
  return (
    typeof reaction === 'string' &&
    (REACTION_TYPES as readonly string[]).includes(reaction)
  );
}

export function computeNextReactionState(
  currentReaction: ReactionType | null,
  clickedReaction: ReactionType,
  currentLikeCount: number
): {
  nextReaction: ReactionType | null;
  nextLikeCount: number;
  operation: 'create' | 'update' | 'delete';
} {
  const safeCount = Math.max(0, Math.floor(Number(currentLikeCount) || 0));
  if (currentReaction === null) {
    return {
      nextReaction: clickedReaction,
      nextLikeCount: safeCount + 1,
      operation: 'create',
    };
  }
  if (currentReaction === clickedReaction) {
    return {
      nextReaction: null,
      nextLikeCount: Math.max(0, safeCount - 1),
      operation: 'delete',
    };
  }
  return {
    nextReaction: clickedReaction,
    nextLikeCount: safeCount,
    operation: 'update',
  };
}

export function sanitizeDisplayName(name: string | null | undefined): string {
  const trimmed = (name || '').trim();
  if (!trimmed) return 'Bus Creator';
  return trimmed.slice(0, BLUEPRINT_LIMITS.DISPLAY_NAME_MAX);
}

export function sanitizePhotoUrl(url: string | null | undefined): string {
  const trimmed = (url || '').trim();
  if (trimmed.length > BLUEPRINT_LIMITS.PHOTO_URL_MAX) {
    return '';
  }
  return trimmed;
}

export function validateVideoUploadInput(
  title: string,
  description: string,
  file: { name: string; type: string; size: number } | null,
  category: string = 'Simulation'
): VideoFormValidationResult {
  const sanitizedTitle = title.trim();
  const sanitizedDescription = description.trim();
  const fallbackCategory: VideoCategory = isValidVideoCategory(category)
    ? category
    : 'Simulation';

  if (!isValidVideoCategory(category)) {
    return {
      valid: false,
      error: `Please select a valid category (${VIDEO_CATEGORIES.join(', ')}).`,
      sanitizedTitle,
      sanitizedDescription,
      sanitizedCategory: fallbackCategory,
    };
  }

  if (!file) {
    return {
      valid: false,
      error: 'Please select an MP4 video file to upload.',
      sanitizedTitle,
      sanitizedDescription,
      sanitizedCategory: category,
    };
  }

  const isMp4Type =
    file.type === 'video/mp4' || file.name.toLowerCase().endsWith('.mp4');
  if (!isMp4Type) {
    return {
      valid: false,
      error: 'Only MP4 video files (.mp4) are supported for Bus Gaming uploads.',
      sanitizedTitle,
      sanitizedDescription,
      sanitizedCategory: category,
    };
  }

  if (file.size <= 0) {
    return {
      valid: false,
      error: 'Selected MP4 file is empty.',
      sanitizedTitle,
      sanitizedDescription,
      sanitizedCategory: category,
    };
  }

  if (
    sanitizedTitle.length < BLUEPRINT_LIMITS.TITLE_MIN ||
    sanitizedTitle.length > BLUEPRINT_LIMITS.TITLE_MAX
  ) {
    return {
      valid: false,
      error: `Video title must be between ${BLUEPRINT_LIMITS.TITLE_MIN} and ${BLUEPRINT_LIMITS.TITLE_MAX} characters.`,
      sanitizedTitle,
      sanitizedDescription,
      sanitizedCategory: category,
    };
  }

  if (
    sanitizedDescription.length < BLUEPRINT_LIMITS.DESCRIPTION_MIN ||
    sanitizedDescription.length > BLUEPRINT_LIMITS.DESCRIPTION_MAX
  ) {
    return {
      valid: false,
      error: `Description must be between ${BLUEPRINT_LIMITS.DESCRIPTION_MIN} and ${BLUEPRINT_LIMITS.DESCRIPTION_MAX} characters.`,
      sanitizedTitle,
      sanitizedDescription,
      sanitizedCategory: category,
    };
  }

  return {
    valid: true,
    sanitizedTitle,
    sanitizedDescription,
    sanitizedCategory: category,
  };
}

export function filterVideosByCategoryAndQuery<
  T extends {
    title: string;
    description: string;
    uploaderName: string;
    category?: string;
  }
>(videos: T[], selectedCategory: string, searchQuery: string): T[] {
  const q = searchQuery.trim().toLowerCase();
  return videos.filter((vid) => {
    const vidCategory = isValidVideoCategory(vid.category)
      ? vid.category
      : 'Simulation';
    const matchesCategory =
      selectedCategory === 'All' || vidCategory === selectedCategory;
    if (!matchesCategory) return false;

    if (!q) return true;
    return (
      vid.title.toLowerCase().includes(q) ||
      vid.description.toLowerCase().includes(q) ||
      vid.uploaderName.toLowerCase().includes(q) ||
      vidCategory.toLowerCase().includes(q)
    );
  });
}

export function buildDriveUrls(driveFileId: string, apiKey?: string): {
  streamUrl: string;
  downloadUrl: string;
  embedPreviewUrl: string;
} {
  const cleanId = driveFileId.trim();
  const downloadUrl = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(cleanId)}`;
  const streamUrl = apiKey
    ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(cleanId)}?alt=media&key=${encodeURIComponent(apiKey)}`
    : `https://drive.google.com/uc?export=download&id=${encodeURIComponent(cleanId)}`;
  const embedPreviewUrl = `https://drive.google.com/file/d/${encodeURIComponent(cleanId)}/preview`;

  return {
    streamUrl: streamUrl.slice(0, BLUEPRINT_LIMITS.URL_MAX),
    downloadUrl: downloadUrl.slice(0, BLUEPRINT_LIMITS.URL_MAX),
    embedPreviewUrl,
  };
}

export function formatUploadNotificationMessage(
  creatorName: string,
  videoTitle: string
): string {
  const safeCreator = sanitizeDisplayName(creatorName);
  const safeTitle = videoTitle.trim().slice(0, BLUEPRINT_LIMITS.TITLE_MAX);
  const raw = `${safeCreator} just uploaded a new video: ${safeTitle}`;
  return raw.slice(0, BLUEPRINT_LIMITS.NOTIFICATION_MESSAGE_MAX);
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}
