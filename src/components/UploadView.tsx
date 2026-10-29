import React, { useState, useRef } from 'react';
import { User } from 'firebase/auth';
import { Upload, Film, CheckCircle2, AlertCircle, HardDrive } from 'lucide-react';
import {
  uploadVideoToDriveAndFirestore,
  UploadProgressState,
  PublicVideoItem,
} from '../services/firebase';
import {
  BLUEPRINT_LIMITS,
  VIDEO_CATEGORIES,
  VideoCategory,
  validateVideoUploadInput,
  formatFileSize,
} from '../utils/videoHubLogic';
import { GoogleSignInButton } from './GoogleSignInButton';

interface UploadViewProps {
  user: User | null;
  hasDriveToken: boolean;
  isSigningIn: boolean;
  onLogin: () => Promise<void>;
  onUploadComplete: (video: PublicVideoItem) => void;
}

export const UploadView: React.FC<UploadViewProps> = ({
  user,
  hasDriveToken,
  isSigningIn,
  onLogin,
  onUploadComplete,
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<VideoCategory>('Simulation');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState<UploadProgressState | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setValidationError(null);
    const file = e.target.files?.[0] || null;
    if (!file) {
      setSelectedFile(null);
      setPreviewUrl(null);
      return;
    }

    if (file.type !== 'video/mp4' && !file.name.toLowerCase().endsWith('.mp4')) {
      setValidationError('Only MP4 video files (.mp4) are supported.');
      setSelectedFile(null);
      setPreviewUrl(null);
      return;
    }

    setSelectedFile(file);
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    const validation = validateVideoUploadInput(
      title,
      description,
      selectedFile,
      category
    );
    if (!validation.valid || !selectedFile) {
      setValidationError(validation.error || 'Please check your input fields.');
      return;
    }

    if (!user || !hasDriveToken) {
      setValidationError('Please sign in with Google to authorize Google Drive MP4 upload.');
      return;
    }

    setIsUploading(true);
    try {
      const createdVideo = await uploadVideoToDriveAndFirestore({
        file: selectedFile,
        title: validation.sanitizedTitle,
        description: validation.sanitizedDescription,
        category: validation.sanitizedCategory,
        user,
        onProgress: (state) => setProgress(state),
      });

      setTitle('');
      setDescription('');
      setCategory('Simulation');
      setSelectedFile(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);

      onUploadComplete(createdVideo);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed.';
      setValidationError(msg);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-[#111520] border border-slate-800/80 rounded-2xl p-4 sm:p-7 space-y-5">
        <div className="space-y-1 border-b border-slate-800 pb-4">
          <h1 className="text-xl sm:text-2xl font-display font-bold tracking-wide text-slate-100">
            Upload Bus Video
          </h1>
          <p className="text-xs sm:text-sm text-slate-400">
            Share no-copyright MP4 bus clips with the community and notify your followers.
          </p>
        </div>

        {/* Auth / Drive Token Gate Banner */}
        {(!user || !hasDriveToken) && (
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3.5">
            <div className="space-y-1">
              <div className="text-xs sm:text-sm font-semibold text-amber-400 flex items-center gap-2">
                <HardDrive className="w-4 h-4 shrink-0" />
                <span>
                  {!user ? 'Sign In Required to Upload' : 'Connect Google Account'}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                {!user
                  ? 'Sign in with your Google account to publish MP4 videos to the hub.'
                  : 'Reconnect your Google session to continue uploading MP4 files.'}
              </p>
            </div>
            <div className="shrink-0">
              <GoogleSignInButton
                onClick={onLogin}
                disabled={isSigningIn}
                label={!user ? 'Sign in with Google' : 'Connect Account'}
              />
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          {/* MP4 File Input */}
          <div className="space-y-2">
            <span className="block text-sm font-semibold text-slate-200">
              MP4 Bus Gaming Video File
            </span>
            <input
              ref={fileInputRef}
              id="mp4-file-input"
              type="file"
              accept="video/mp4,.mp4"
              onChange={handleFileChange}
              disabled={isUploading}
              tabIndex={-1}
              aria-hidden="true"
              className="sr-only"
            />
            <button
              type="button"
              aria-label="Select MP4 Bus Gaming Video File"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="w-full min-h-[132px] p-5 rounded-xl border border-dashed border-slate-700 hover:border-amber-500/60 bg-slate-900/50 hover:bg-slate-900/90 transition-colors flex flex-col items-center justify-center gap-2 text-center cursor-pointer disabled:opacity-50"
            >
              <Film className="w-8 h-8 text-amber-400" />
              {selectedFile ? (
                <div className="space-y-0.5">
                  <div className="text-sm font-semibold text-slate-100">
                    {selectedFile.name}
                  </div>
                  <div className="text-xs font-mono tabular-nums text-amber-400">
                    {formatFileSize(selectedFile.size)} · Ready to Upload
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-slate-200">
                    Select MP4 Video File
                  </div>
                  <div className="text-xs text-slate-400">
                    Supports 1080p / 4K 60FPS Bus Simulator & Bus Livery MP4 clips
                  </div>
                </div>
              )}
            </button>

            {previewUrl && (
              <div className="mt-3 rounded-xl overflow-hidden bg-black border border-slate-800 aspect-video">
                <video
                  src={previewUrl}
                  controls
                  playsInline
                  className="w-full h-full object-contain"
                />
              </div>
            )}
          </div>

          {/* Video Title & Category Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="video-title-input"
                  className="block text-sm font-semibold text-slate-200"
                >
                  Video Title
                </label>
                <span className="text-xs font-mono tabular-nums text-slate-400">
                  {title.length}/{BLUEPRINT_LIMITS.TITLE_MAX}
                </span>
              </div>
              <input
                id="video-title-input"
                type="text"
                value={title}
                maxLength={BLUEPRINT_LIMITS.TITLE_MAX}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (validationError) setValidationError(null);
                }}
                disabled={isUploading}
                placeholder="e.g., BUSSID Kerala Komban Night Ghat Road 60FPS Raw Clip"
                className="w-full h-11 px-4 rounded-xl bg-slate-900 border border-slate-800 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="video-category-select"
                className="block text-sm font-semibold text-slate-200"
              >
                Category
              </label>
              <select
                id="video-category-select"
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value as VideoCategory);
                  if (validationError) setValidationError(null);
                }}
                disabled={isUploading}
                className="w-full h-11 px-3.5 rounded-xl bg-slate-900 border border-slate-800 text-sm text-slate-100 focus:outline-none focus:border-amber-500 cursor-pointer"
              >
                {VIDEO_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat} className="bg-slate-900 text-slate-100">
                    {cat}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Video Description */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label
                htmlFor="video-description-input"
                className="block text-sm font-semibold text-slate-200"
              >
                Description & Usage Notes
              </label>
              <span className="text-xs font-mono tabular-nums text-slate-400">
                {description.length}/{BLUEPRINT_LIMITS.DESCRIPTION_MAX}
              </span>
            </div>
            <textarea
              id="video-description-input"
              rows={4}
              value={description}
              maxLength={BLUEPRINT_LIMITS.DESCRIPTION_MAX}
              onChange={(e) => {
                setDescription(e.target.value);
                if (validationError) setValidationError(null);
              }}
              disabled={isUploading}
              placeholder="Specify bus mod name, map route, camera angle, and confirm 100% no-copyright free reuse for creators..."
              className="w-full p-4 rounded-xl bg-slate-900 border border-slate-800 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-500 resize-y"
            />
          </div>

          {/* Google Drive Real-Time Upload Progress Bar */}
          {progress && (
            <div
              className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2.5"
              aria-live="polite"
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-200 flex items-center gap-2">
                  {progress.stage === 'done' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <Upload className="w-4 h-4 text-amber-400 shrink-0" />
                  )}
                  <span>{progress.statusText}</span>
                </span>
                <span className="font-mono tabular-nums font-semibold text-amber-400">
                  {progress.percent}%
                </span>
              </div>
              <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 transition-transform duration-150 origin-left"
                  style={{ transform: `scaleX(${progress.percent / 100})` }}
                />
              </div>
            </div>
          )}

          {/* Error Alert */}
          {validationError && (
            <div
              role="alert"
              className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2.5"
            >
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{validationError}</span>
            </div>
          )}

          {/* Submit Action */}
          <button
            type="submit"
            disabled={isUploading}
            className="w-full min-h-[48px] py-3 px-6 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <Upload className="w-4 h-4" />
            <span>
              {isUploading ? 'Uploading & Publishing...' : 'Publish Video'}
            </span>
          </button>
        </form>
      </div>
    </div>
  );
};
