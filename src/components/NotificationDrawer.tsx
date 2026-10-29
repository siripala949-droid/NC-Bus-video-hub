import React, { useState } from 'react';
import { Bell, CheckCheck, X, User as UserIcon, Video } from 'lucide-react';
import { UserNotificationItem } from '../services/firebase';

interface NotificationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: UserNotificationItem[];
  isSignedIn: boolean;
  browserPermission: NotificationPermission | 'unsupported';
  onRequestBrowserPermission: () => void;
  onMarkAsRead: (notification: UserNotificationItem) => void;
  onMarkAllRead: () => void;
  onSelectCreatorFromNotification: (creatorId: string) => void;
}

export const NotificationDrawer: React.FC<NotificationDrawerProps> = ({
  isOpen,
  onClose,
  notifications,
  isSignedIn,
  browserPermission,
  onRequestBrowserPermission,
  onMarkAsRead,
  onMarkAllRead,
  onSelectCreatorFromNotification,
}) => {
  const [brokenAvatars, setBrokenAvatars] = useState<Record<string, boolean>>({});

  if (!isOpen) return null;

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-end bg-black/60 backdrop-blur-sm p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Notifications"
    >
      <div className="w-full max-w-md bg-[#111520] border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[82vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Bell className="w-4 h-4 text-amber-400" />
            <h2 className="text-lg font-display font-bold tracking-wide text-slate-100">
              Notifications
            </h2>
            <span className="text-xs font-mono tabular-nums text-slate-400">
              · {unreadCount} unread
            </span>
          </div>

          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={onMarkAllRead}
                className="min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-medium text-amber-400 hover:bg-amber-500/10 flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>Mark all read</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close notifications"
              className="min-h-[40px] min-w-[40px] rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 flex items-center justify-center transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Browser Push Status Bar */}
        {isSignedIn && browserPermission !== 'granted' && browserPermission !== 'unsupported' && (
          <div className="px-5 py-3 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between gap-3">
            <p className="text-xs text-slate-300">
              Enable browser push alerts when followed creators upload new bus videos.
            </p>
            <button
              type="button"
              onClick={onRequestBrowserPermission}
              className="min-h-[36px] px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs transition-colors whitespace-nowrap shrink-0"
            >
              Enable Push
            </button>
          </div>
        )}

        {/* Body */}
        <div className="overflow-y-auto divide-y divide-slate-800/70 flex-1">
          {!isSignedIn ? (
            <div className="p-8 text-center space-y-2">
              <p className="text-sm font-medium text-slate-200">
                Sign in with Google to receive creator upload alerts
              </p>
              <p className="text-xs text-slate-400">
                Follow bus gaming creators to get instant in-app and browser push notifications whenever they publish a new MP4.
              </p>
            </div>
          ) : notifications.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <Video className="w-8 h-8 text-slate-600 mx-auto" />
              <p className="text-sm font-medium text-slate-200">No notifications yet</p>
              <p className="text-xs text-slate-400">
                When creators you follow upload new no-copyright bus videos, alerts will appear here in real time.
              </p>
            </div>
          ) : (
            notifications.map((item) => {
              const timeStr = item.createdAt?.toDate
                ? item.createdAt.toDate().toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })
                : 'Just now';

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (!item.read) {
                      onMarkAsRead(item);
                    }
                    onSelectCreatorFromNotification(item.senderId);
                    onClose();
                  }}
                  className={`w-full text-left px-5 py-4 flex items-start gap-3.5 hover:bg-slate-800/50 transition-colors ${
                    !item.read ? 'bg-amber-500/[0.04]' : ''
                  }`}
                >
                  {item.senderPhoto && !brokenAvatars[item.id] ? (
                    <img
                      src={item.senderPhoto}
                      alt={item.senderName}
                      referrerPolicy="no-referrer"
                      onError={() =>
                        setBrokenAvatars((prev) => ({ ...prev, [item.id]: true }))
                      }
                      className="w-10 h-10 rounded-full object-cover border border-slate-700 shrink-0 mt-0.5"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-amber-400 shrink-0 mt-0.5">
                      <UserIcon className="w-4 h-4" />
                    </div>
                  )}

                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-sm text-slate-100 leading-snug">
                      {item.message}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <span>{timeStr}</span>
                      {!item.read && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-amber-400 font-semibold">Unread</span>
                        </>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
