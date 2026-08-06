import type { NextRequest } from "next/server";
import { normalizeRoomCode } from "@/lib/room-code";
import { roomView } from "@/lib/room.server";
import { subscribeRoom } from "@/lib/room-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-Sent Events stream of a room's live state — the push replacement for
// the old 2.5s polling. Sends an initial snapshot, then a fresh `roomView` every
// time a mutation route calls emitRoom(code), plus a heartbeat so proxies keep
// the connection open. When the room is gone it emits `{ closed: true }` so the
// client drops its stale membership.
export async function GET(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const code = normalizeRoomCode((await ctx.params).code);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;

      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true; // controller already torn down
        }
      };
      const send = (obj: unknown) => write(`data: ${JSON.stringify(obj)}\n\n`);

      // Read the current state and push it (or a "closed" signal if the room is
      // gone). Coalesced so a burst of emits can't overlap DB reads.
      let pushing = false;
      let again = false;
      const push = async () => {
        if (pushing) {
          again = true;
          return;
        }
        pushing = true;
        try {
          const view = await roomView(code);
          send(view ? { room: view } : { closed: true });
        } catch {
          /* transient DB error — keep the stream open, next emit retries */
        } finally {
          pushing = false;
          if (again) {
            again = false;
            void push();
          }
        }
      };

      await push(); // initial snapshot
      const unsub = subscribeRoom(code, () => void push());
      const heartbeat = setInterval(() => write(`: ping\n\n`), 20_000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsub();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      // Client navigated away / closed the tab.
      req.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Tell nginx (and other proxies) not to buffer, so events flush live.
      "X-Accel-Buffering": "no",
    },
  });
}
