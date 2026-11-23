"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useSocket } from "@/contexts/SocketContext";
import type { PollResults } from "@/types";

interface JoinAck {
  ok: boolean;
  data?: { results: PollResults };
  error?: { code: string; message: string };
}

interface ClosedPayload {
  pollId: string;
  question: string;
  closedAt: string;
  results: PollResults;
}

/**
 * Subscribes the page to the Socket.IO room "poll:<id>".
 *  - emits "poll:join" on mount and after every reconnection (rooms are lost on disconnect);
 *  - receives "poll:results" after each committed vote and "poll:closed" at closure;
 *  - emits "poll:leave" when the page is left.
 * The server is the source of truth: the hook only displays what it receives.
 */
export function usePollRoom(pollId: string, onClosed?: (payload: ClosedPayload) => void) {
  const { socket, connected } = useSocket();
  const [results, setResults] = useState<PollResults | null>(null);
  const [roomError, setRoomError] = useState<string | null>(null);
  const resultsRef = useRef<PollResults | null>(null);
  const onClosedRef = useRef(onClosed);

  useEffect(() => {
    onClosedRef.current = onClosed;
  }, [onClosed]);

  const update = (r: PollResults) => {
    resultsRef.current = r;
    setResults(r);
  };

  useEffect(() => {
    if (!socket) return;

    const join = () => {
      socket.emit("poll:join", { pollId }, (ack: JoinAck) => {
        if (ack.ok && ack.data) {
          update(ack.data.results);
          setRoomError(null);
        } else {
          setRoomError(ack.error?.message ?? "Impossible de rejoindre le sondage en temps réel");
        }
      });
    };

    const onResults = (r: PollResults) => {
      if (r.pollId !== pollId) return;
      // Broadcasts are "public" views. The creator of an AFTER_CLOSE poll is
      // allowed to see the details, so they re-fetch their own view over HTTP.
      if (!r.visible && resultsRef.current?.visible) {
        api.results(pollId).then((d) => update(d.results)).catch(() => undefined);
        return;
      }
      update(r);
    };

    const onPollClosed = (payload: ClosedPayload) => {
      if (payload.pollId !== pollId) return;
      update(payload.results);
      onClosedRef.current?.(payload);
    };

    socket.on("connect", join); // re-join after a reconnection
    socket.on("poll:results", onResults);
    socket.on("poll:closed", onPollClosed);
    if (socket.connected) join();

    return () => {
      socket.emit("poll:leave", { pollId });
      socket.off("connect", join);
      socket.off("poll:results", onResults);
      socket.off("poll:closed", onPollClosed);
    };
  }, [socket, pollId]);

  return { results, setResults: update, connected, roomError };
}
