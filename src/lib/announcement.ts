// The site announcement shown in the dashboard bell. Edit this to post a new
// message, then redeploy. Set `message: ""` to have no active announcement
// (the bell then stays quiet with nothing to read).
//
// IMPORTANT: whenever you post a NEW message, also change `id` to a new value.
// The bell tracks "read" per browser by this id, so bumping the id makes the
// bell ring again for everyone (a changed message keeping the same id would be
// treated as already read).
export type Announcement = {
  id: string;
  title: string;
  message: string;
};

export const ANNOUNCEMENT: Announcement = {
  id: "2026-08-15-update-3",
  title: "New update",
  message:
    "We just rolled out a small update with new features and improvements. Sorry for any brief hiccups or lost connection during the rollout — just refresh if something looks off. Thanks for playing! 🎬",
};

// True when there's an actual message to show (drives the bell's unread state).
export const ANNOUNCEMENT_ACTIVE = ANNOUNCEMENT.message.trim().length > 0;
