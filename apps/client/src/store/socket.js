// src/store/socket.js
import { io } from "socket.io-client";
import { useEffect, useRef, useCallback } from "react";
import { useUser } from "./session";
import Cookies from "js-cookie";

const SOCKET_URL = "http://localhost:5004";
const SOCKETS_ENABLED = import.meta.env.VITE_ENABLE_SOCKETS === "true";

export const useSocket = () => {
  const { user } = useUser();
  const socketRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);

  const setupSocketListeners = useCallback((socket) => {
    if (!socket) return;

    // Debug: Log all incoming events (filtered to avoid spam)
    if (process.env.NODE_ENV !== 'production') {
      socket.onAny((event, ...args) => {
        // Skip frequent events from spamming console
        const spammyEvents = ['ping', 'pong', 'ticket:comment'];
        if (!spammyEvents.includes(event)) {
          console.log(`📡 [Socket Incoming] ${event}:`, args[0] || '');
        }
      });
    }

    // Connection events
    socket.on("connect", () => {
      console.log("✅ Socket Connected:", {
        id: socket.id,
        user: user?.email,
        attempts: reconnectAttemptsRef.current
      });
      reconnectAttemptsRef.current = 0;
      
      // Join user room and agents room if applicable
      if (user?._id) {
        socket.emit("join-user");
        
        if (user?.role === 'admin' || user?.role === 'agent') {
          socket.emit("join-agents");
        }
      }
    });

    socket.on("connect_error", (err) => {
      console.error("❌ Socket Connect Error:", {
        message: err.message,
        attempts: reconnectAttemptsRef.current + 1
      });
      reconnectAttemptsRef.current++;
    });

    socket.on("disconnect", (reason) => {
      console.log("🔌 Socket Disconnected:", {
        reason,
        wasConnected: socket.connected,
        attempts: reconnectAttemptsRef.current
      });
    });

    socket.on("error", (err) => {
      console.error("❌ Socket Error:", err);
    });

    // Room management responses
    socket.on("ticket:joined", (data) => {
      console.log("✅ Joined ticket room:", {
        ticketId: data.ticketId,
        success: data.success,
        timestamp: data.timestamp
      });
    });

    socket.on("ticket:join-error", (data) => {
      console.error("❌ Failed to join ticket room:", data);
    });

    socket.on("ticket:left", (data) => {
      console.log("🚪 Left ticket room:", {
        ticketId: data.ticketId,
        success: data.success,
        timestamp: data.timestamp
      });
    });

    socket.on("user:joined", (data) => {
      console.log("👤 Joined user room:", {
        userId: data.userId,
        success: data.success
      });
    });

    socket.on("agents:joined", (data) => {
      console.log("👥 Joined agents room:", {
        success: data.success
      });
    });

    // Test endpoint responses
    socket.on("pong", (data) => {
      console.log("🏓 Pong received:", {
        serverTime: data.serverTime,
        socketId: data.socketId
      });
    });

    // Ticket events
    socket.on("ticket:comment", (comment) => {
      console.log("📨 Ticket comment via socket:", {
        id: comment._id?.substring(0, 8),
        text: comment.text?.substring(0, 80),
        userId: comment.userId?._id || comment.userId,
        userObj: comment.userId,
        reply: comment.reply,
        replyEmail: comment.replyEmail,
        fromAgent: comment.fromAgent,
        timestamp: new Date().toISOString()
      });
    });

    socket.on("ticket:status", (ticket) => {
      console.log("🔄 Ticket status update:", {
        id: ticket._id,
        status: ticket.isComplete ? "Closed" : "Open",
        number: ticket.number,
        title: ticket.title
      });
    });

    socket.on("ticket:update", (ticket) => {
      console.log("📝 Ticket general update:", {
        id: ticket._id,
        assignedTo: ticket.assignedTo?.name,
        priority: ticket.priority,
        isComplete: ticket.isComplete
      });
    });

    socket.on("ticket:assigned", (ticket) => {
      console.log("👤 Ticket assigned to you:", {
        id: ticket._id,
        assignedTo: ticket.assignedTo?.name,
        number: ticket.number,
        title: ticket.title
      });
    });

    socket.on("ticket:unassigned", (ticket) => {
      console.log("👤 Ticket unassigned from you:", {
        id: ticket._id,
        number: ticket.number,
        title: ticket.title
      });
    });

    socket.on("ticket:new", (ticket) => {
      console.log("🎫 New ticket created:", {
        id: ticket._id,
        number: ticket.number,
        title: ticket.title,
        priority: ticket.priority
      });
    });

    // User-specific events
    socket.on("notification:new", (notification) => {
      console.log("🔔 New notification:", notification);
    });

    socket.on("user:notification", (data) => {
      console.log("👤 User notification:", data);
    });
  }, [user]);

  useEffect(() => {
    if (!SOCKETS_ENABLED) {
      return;
    }

    if (!user?._id) {
      console.log("❌ No user ID, skipping socket connection");
      return;
    }

    const token = Cookies.get("session");
    if (!token) {
      console.log("❌ No session token, skipping socket connection");
      return;
    }

    // Disconnect existing socket if any
    if (socketRef.current) {
      console.log("🔄 Disconnecting existing socket");
      socketRef.current.disconnect();
      socketRef.current.removeAllListeners();
      socketRef.current = null;
    }

    console.log("🔌 Creating new socket connection...");
    socketRef.current = io(SOCKET_URL, {
      auth: { token },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      forceNew: true,
    });

    const socket = socketRef.current;
    setupSocketListeners(socket);

    // Connection test
    const testTimeout = setTimeout(() => {
      if (socket.connected) {
        console.log("🧪 Testing socket connection...");
        socket.emit("ping", { 
          test: "socket connection test",
          userId: user._id,
          timestamp: Date.now()
        });
      }
    }, 1000);

    return () => {
      console.log("🧹 Cleaning up socket connection");
      clearTimeout(testTimeout);
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current.removeAllListeners();
        socketRef.current = null;
      }
    };
  }, [user?._id, user?.role, setupSocketListeners]);

  return socketRef.current;
};

// Helper functions for socket operations
export const socketHelpers = {
  joinTicket: (socket, ticketId) => {
    if (!socket || !socket.connected) {
      console.error("❌ Cannot join ticket: Socket not connected");
      return false;
    }
    if (!ticketId || !/^[0-9a-fA-F]{24}$/.test(ticketId)) {
      console.error("❌ Cannot join ticket: Invalid ticket ID format", ticketId);
      return false;
    }
    console.log("🎯 Joining ticket room:", ticketId);
    socket.emit("join-ticket", ticketId);
    return true;
  },

  leaveTicket: (socket, ticketId) => {
    if (!socket || !socket.connected) {
      console.error("❌ Cannot leave ticket: Socket not connected");
      return false;
    }
    if (!ticketId || !/^[0-9a-fA-F]{24}$/.test(ticketId)) {
      console.error("❌ Cannot leave ticket: Invalid ticket ID format", ticketId);
      return false;
    }
    console.log("🎯 Leaving ticket room:", ticketId);
    socket.emit("leave-ticket", ticketId);
    return true;
  },

  joinUserRoom: (socket) => {
    if (!socket || !socket.connected) {
      console.error("❌ Cannot join user room: Socket not connected");
      return false;
    }
    console.log("👤 Joining user room");
    socket.emit("join-user");
    return true;
  },

  joinAgentsRoom: (socket) => {
    if (!socket || !socket.connected) {
      console.error("❌ Cannot join agents room: Socket not connected");
      return false;
    }
    console.log("👥 Joining agents room");
    socket.emit("join-agents");
    return true;
  },

  testConnection: (socket, data = {}) => {
    if (!socket || !socket.connected) {
      console.error("❌ Cannot test: Socket not connected");
      return false;
    }
    console.log("🧪 Testing socket connection...");
    socket.emit("ping", { 
      test: "connection test", 
      timestamp: Date.now(),
      ...data 
    });
    return true;
  },

  getSocketState: (socket) => {
    if (!socket) return null;
    return {
      connected: socket.connected,
      id: socket.id,
      hasListeners: Object.keys(socket._callbacks || {}),
      rooms: socket.rooms ? Array.from(socket.rooms) : []
    };
  }
};

// Custom hook for ticket room management
export const useTicketSocket = (ticketId) => {
  const socket = useSocket();
  
  const joinTicketRoom = useCallback(() => {
    if (!ticketId) {
      console.error("❌ No ticket ID provided for joining room");
      return false;
    }
    return socketHelpers.joinTicket(socket, ticketId);
  }, [socket, ticketId]);

  const leaveTicketRoom = useCallback(() => {
    if (!ticketId) {
      console.error("❌ No ticket ID provided for leaving room");
      return false;
    }
    return socketHelpers.leaveTicket(socket, ticketId);
  }, [socket, ticketId]);

  useEffect(() => {
    if (!socket || !ticketId) return;

    // Auto-join ticket room when socket connects
    const handleConnect = () => {
      if (socket.connected) {
        joinTicketRoom();
      }
    };

    socket.on("connect", handleConnect);
    
    // Join immediately if already connected
    if (socket.connected) {
      joinTicketRoom();
    }

    return () => {
      socket.off("connect", handleConnect);
      leaveTicketRoom();
    };
  }, [socket, ticketId, joinTicketRoom, leaveTicketRoom]);

  return {
    socket,
    joinTicketRoom,
    leaveTicketRoom,
    isConnected: socket?.connected || false,
    socketId: socket?.id
  };
};
