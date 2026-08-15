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
  id: "2026-08-15-maintenance",
  title: "Server maintenance",
  message:
    "We're sorry for the trouble — the server is currently under maintenance, so you may run into connection problems while playing. We're working on it. Thanks for your patience!",
};

// True when there's an actual message to show (drives the bell's unread state).
export const ANNOUNCEMENT_ACTIVE = ANNOUNCEMENT.message.trim().length > 0;
