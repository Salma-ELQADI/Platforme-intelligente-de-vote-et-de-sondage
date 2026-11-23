"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Socket } from "socket.io-client";
import { api } from "@/lib/api";
import { createSocket } from "@/lib/socket";
import type { Notification } from "@/types";
import { useAuth } from "./AuthContext";
import { useToast } from "./ToastContext";

interface SocketContextValue {
  socket: Socket | null;
  connected: boolean;
  unreadCount: number;
  setUnreadCount: (n: number | ((n: number) => number)) => void;
}

const SocketContext = createContext<SocketContextValue>({ socket: null, connected: false, unreadCount: 0, setUnreadCount: () => undefined });

/**
 * One Socket.IO connection per browser tab, opened only while the user is
 * logged in (the server refuses anonymous sockets). It also listens to
 * personal notifications ("notification:new") wherever the user is in the app.
 */
export function SocketProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const toast = useToast();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!user) return;

    const s = createSocket();
    s.on("connect", () => {
      setSocket(s); // exposed once connected; same object on every reconnection
      setConnected(true);
    });
    s.on("disconnect", () => setConnected(false));
    s.on("notification:new", (n: Notification) => {
      setUnreadCount((c) => c + 1);
      toast(n.message, "info");
    });

    // Initial unread counter (notifications received while offline).
    api.notifications().then((d) => setUnreadCount(d.unreadCount)).catch(() => undefined);

    return () => {
      s.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, [user, toast]);

  return <SocketContext.Provider value={{ socket, connected, unreadCount, setUnreadCount }}>{children}</SocketContext.Provider>;
}

export const useSocket = () => useContext(SocketContext);
