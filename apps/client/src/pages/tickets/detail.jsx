// src/pages/tickets/detail.jsx
import React, { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Check, Send, ArrowLeft, Copy, RefreshCw, Loader2, Mail, User, MessageSquare } from "lucide-react";
import { toast } from "react-toastify";
import { useUser } from "../../store/session";
import { useSocket } from "../../store/socket";

const TicketDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { fetchWithAuth, user } = useUser();
  const socket = useSocket();

  const [ticket, setTicket] = useState(null);
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [postingComment, setPostingComment] = useState(false);
  const [activeTab, setActiveTab] = useState("activity");
  
  const chatRef = useRef(null);

  const fetchTicket = useCallback(async () => {
    try {
      setLoading(true);
      setHasError(false);
      console.log("📡 Fetching ticket:", id);
      
      const response = await fetchWithAuth(`/v1/ticket/${id}`);
      if (!response.ok) {
        const errorText = await response.text();
        console.error("❌ API Error Response:", {
          status: response.status,
          statusText: response.statusText,
          error: errorText
        });
        throw new Error(`Failed to fetch ticket: ${response.status} ${response.statusText}`);
      }
      
      const result = await response.json();
      console.log("✅ Ticket API Response:", {
        success: result.success,
        ticketId: result.ticket?._id,
        ticketNumber: result.ticket?.number,
        hasTicket: !!result.ticket,
        commentsCount: result.comments?.length || 0,
        hasTimeTracking: !!result.timeTracking
      });
      
      if (result.success && result.ticket) {
        setTicket(result.ticket);
        
        // Sort comments by date to ensure proper order
        const sortedComments = (result.comments || []).sort((a, b) => 
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
        
        // Log comments summary
        console.log("📝 Comments loaded:", sortedComments.length);
        if (sortedComments.length > 0) {
          console.log("📋 Comments summary:");
          sortedComments.forEach((comment, i) => {
            console.log(`   ${i + 1}. ID: ${comment._id?.substring(0, 8)}...`);
            console.log(`      Text: ${comment.text?.substring(0, 60)}...`);
            console.log(`      User: ${comment.userId ? (typeof comment.userId === 'object' ? comment.userId.name : comment.userId) : 'No user'}`);
            console.log(`      Reply: ${comment.reply}, ReplyEmail: ${comment.replyEmail}`);
            console.log(`      FromAgent: ${comment.fromAgent}, Public: ${comment.public}`);
            console.log(`      Date: ${new Date(comment.createdAt).toLocaleString()}`);
            console.log(`   ---`);
          });
        }
        
        setComments(sortedComments);
      } else {
        throw new Error(result.message || "Failed to load ticket data");
      }
    } catch (err) {
      console.error("❌ Fetch Ticket Error:", err);
      setHasError(true);
      toast.error(`Error loading ticket: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, id]);

  // Initial fetch
  useEffect(() => {
    fetchTicket();
  }, [fetchTicket]);

  // Socket integration for real-time comments
  useEffect(() => {
    if (!socket || !id) {
      console.log("❌ Socket not available or no ticket ID");
      return;
    }

    console.log("🔌 Setting up socket listeners for ticket:", id);

    // Join ticket room - Use hyphen to match backend
    socket.emit("join-ticket", id);
    console.log("🎯 Emitted join-ticket for:", id);

    const handleNewComment = (comment) => {
      console.log("📨 New comment via socket:", {
        id: comment._id?.substring(0, 8),
        text: comment.text?.substring(0, 60),
        userId: comment.userId,
        userObj: typeof comment.userId === 'object' ? comment.userId : null,
        reply: comment.reply,
        replyEmail: comment.replyEmail,
        fromAgent: comment.fromAgent,
        createdAt: comment.createdAt
      });

      setComments(prev => {
        // Check if comment already exists
        const exists = prev.some(c => c._id === comment._id);
        if (exists) {
          console.log("⚠️ Comment already exists:", comment._id?.substring(0, 8));
          return prev;
        }
        
        console.log("➕ Adding new comment to state:", comment._id?.substring(0, 8));
        
        // Add new comment and sort by date
        const newComments = [...prev, comment].sort((a, b) => 
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
        
        return newComments;
      });
    };

    const handleTicketUpdate = (updatedTicket) => {
      console.log("📝 Ticket update via socket:", {
        id: updatedTicket._id,
        status: updatedTicket.isComplete ? "Closed" : "Open",
        assignedTo: updatedTicket.assignedTo?.name
      });
      
      if (updatedTicket._id === id) {
        setTicket(updatedTicket);
      }
    };

    const handleTicketStatus = (statusTicket) => {
      console.log("🔄 Ticket status update via socket:", {
        id: statusTicket._id,
        isComplete: statusTicket.isComplete
      });
      
      if (statusTicket._id === id) {
        setTicket(statusTicket);
        toast.info(`Ticket ${statusTicket.isComplete ? "closed" : "reopened"}`);
      }
    };

    // Listen for socket events
    socket.on("ticket:comment", handleNewComment);
    socket.on("ticket:update", handleTicketUpdate);
    socket.on("ticket:status", handleTicketStatus);
    
    // Room join acknowledgement
    socket.on("ticket:joined", (data) => {
      console.log("✅ Successfully joined ticket room:", data);
    });

    // Debug socket connection
    const testSocket = () => {
      if (socket.connected) {
        console.log("🧪 Testing socket connection...");
        socket.emit("ping", { 
          ticketId: id,
          userId: user?._id,
          timestamp: Date.now() 
        });
      }
    };

    // Test after a short delay
    const testTimeout = setTimeout(testSocket, 1000);

    // Cleanup function
    return () => {
      console.log("🧹 Cleaning up socket listeners for ticket:", id);
      clearTimeout(testTimeout);
      socket.off("ticket:comment", handleNewComment);
      socket.off("ticket:update", handleTicketUpdate);
      socket.off("ticket:status", handleTicketStatus);
      socket.off("ticket:joined");
      socket.emit("leave-ticket", id);
    };
  }, [socket, id, user?._id]);

  // Auto-scroll to bottom when new comments are added
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [comments]);

  // Remove duplicate comments
  useEffect(() => {
    if (comments.length < 2) return;
    
    const uniqueComments = [];
    const seenIds = new Set();
    let duplicates = 0;
    
    for (const comment of comments) {
      if (!comment._id) continue;
      
      if (seenIds.has(comment._id)) {
        duplicates++;
        console.log("🔄 Found duplicate comment:", comment._id?.substring(0, 8));
        continue;
      }
      
      seenIds.add(comment._id);
      uniqueComments.push(comment);
    }
    
    if (duplicates > 0 && uniqueComments.length !== comments.length) {
      console.log(`🧹 Removed ${duplicates} duplicate comments`);
      setComments(uniqueComments);
    }
  }, [comments]);

  const handleStatusUpdate = async () => {
    if (updating || !ticket) return;
    setUpdating(true);

    try {
      console.log("🔄 Updating status for ticket:", ticket._id);
      const res = await fetchWithAuth("/v1/ticket/status/update", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: ticket._id,
          status: !ticket.isComplete,
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errorText}`);
      }

      const result = await res.json();
      console.log("✅ Status update response:", {
        success: result.success,
        newStatus: result.ticket?.isComplete ? "Closed" : "Open",
        ticketId: result.ticket?._id
      });
      
      if (result.success) {
        setTicket(result.ticket);
        toast.success(`Ticket marked as ${result.ticket.isComplete ? "Closed" : "Open"}`);
      } else {
        throw new Error(result.message || "Status update failed");
      }
    } catch (err) {
      console.error("❌ Status Update Error:", err);
      toast.error(`Failed to update status: ${err.message}`);
    } finally {
      setUpdating(false);
    }
  };

  const handleAddComment = async () => {
    if (!newComment.trim()) {
      toast.warning("Please enter a comment");
      return;
    }
    
    const commentText = newComment.trim();
    
    // Optimistic update - create temporary comment
    const tempId = `temp-${Date.now()}`;
    const optimisticComment = {
      _id: tempId,
      text: commentText,
      userId: { 
        _id: user._id, 
        name: user.name || user.email,
        email: user.email,
        avatar: user.avatar 
      },
      createdAt: new Date().toISOString(),
      reply: false,
      public: true,
      fromAgent: true,
      isOptimistic: true
    };

    console.log("➕ Adding optimistic comment:", {
      tempId,
      textLength: commentText.length,
      user: user.email
    });

    // Add optimistic comment
    setComments(prev => [...prev, optimisticComment]);
    setNewComment("");
    setPostingComment(true);

    try {
      console.log("📤 Sending comment to API...");
      const response = await fetchWithAuth("/v1/ticket/comment", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ 
          text: commentText, 
          id: id, 
          public: true 
        }),
      });

      console.log("📥 Comment API Response:", {
        status: response.status,
        statusText: response.statusText
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error("❌ Comment API Error:", errorText);
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      console.log("✅ Comment API Success:", {
        success: result.success,
        hasComment: !!result.comment,
        commentId: result.comment?._id,
        commentText: result.comment?.text?.substring(0, 50)
      });
      
      if (result.success && result.comment) {
        // Remove optimistic comment (socket will add the real one)
        setComments(prev => prev.filter(c => c._id !== tempId));
        toast.success("Reply sent & customer notified");
      } else {
        throw new Error(result.message || "Failed to add comment");
      }
    } catch (err) {
      console.error("❌ Add Comment Error:", err);
      // Remove optimistic comment on error
      setComments(prev => prev.filter(c => c._id !== tempId));
      setNewComment(commentText); // Restore the text
      toast.error(`Error: ${err.message}`);
    } finally {
      setPostingComment(false);
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    toast.success("Link copied to clipboard");
  };

  const handleRefresh = () => {
    console.log("🔃 Manually refreshing ticket...");
    fetchTicket();
    toast.info("Refreshing ticket...");
  };

  // Enhanced function to detect email replies
  const isEmailReply = (comment) => {
    // If it's explicitly a reply from email
    if (comment.reply === true && comment.replyEmail) {
      return true;
    }
    
    // If it has fromAgent flag, it's from an agent
    if (comment.fromAgent === true) {
      return false;
    }
    
    // If it has no userId but has text (likely email)
    if (!comment.userId && comment.text && comment._id && !comment._id.startsWith('temp-')) {
      return true;
    }
    
    // If userId is a string (not populated), could be email
    if (typeof comment.userId === 'string' && comment.replyEmail) {
      return true;
    }
    
    // Default: not an email reply
    return false;
  };

  // Get the sender email for email replies
  const getEmailSender = (comment) => {
    if (comment.replyEmail) return comment.replyEmail;
    if (comment.email) return comment.email;
    return ticket?.email || "Customer";
  };

  // Get display name for comment
  const getSenderName = (comment) => {
    if (isEmailReply(comment)) {
      const email = getEmailSender(comment);
      return email?.split('@')[0] || "Customer";
    }
    
    if (comment.userId) {
      if (typeof comment.userId === 'object') {
        return comment.userId.name || comment.userId.email || "Agent";
      }
      return "Agent";
    }
    
    if (comment.isOptimistic) {
      return user.name || user.email || "You";
    }
    
    return "System";
  };

  // Get role badge for comment
  const getCommentRole = (comment) => {
    if (comment.isOptimistic) {
      return "You (Sending...)";
    }
    
    if (isEmailReply(comment)) {
      return "Customer (Email)";
    }
    
    if (comment.userId) {
      if (typeof comment.userId === 'object' && comment.userId._id === user?._id) {
        return "You (Agent)";
      }
      return "Agent";
    }
    
    return "System";
  };

  // Get avatar background color
  const getAvatarColor = (comment) => {
    if (comment.isOptimistic) return "bg-gray-100 text-gray-800";
    if (isEmailReply(comment)) return "bg-purple-100 text-purple-800";
    if (comment.userId?._id === user?._id) return "bg-green-100 text-green-800";
    if (comment.userId) return "bg-blue-100 text-blue-800";
    return "bg-gray-100 text-gray-800";
  };

  // Get message background color
  const getMessageColor = (comment) => {
    if (comment.isOptimistic) return "bg-gray-50 border-l-4 border-gray-300 opacity-80";
    if (isEmailReply(comment)) return "bg-purple-50 border-l-4 border-purple-300";
    if (comment.userId?._id === user?._id) return "bg-green-50 border-l-4 border-green-300";
    if (comment.userId) return "bg-blue-50 border-l-4 border-blue-300";
    return "bg-gray-50 border-l-4 border-gray-300";
  };

  // Get initials for avatar
  const getInitials = (comment) => {
    if (comment.isOptimistic) {
      return user.name?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase() || "Y";
    }
    
    if (isEmailReply(comment)) {
      const email = getEmailSender(comment);
      return email?.[0]?.toUpperCase() || "C";
    }
    
    if (comment.userId) {
      if (typeof comment.userId === 'object') {
        return comment.userId.name?.[0]?.toUpperCase() || 
               comment.userId.email?.[0]?.toUpperCase() || 
               "A";
      }
      return "A";
    }
    
    return "S";
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-600 mx-auto" />
          <p className="mt-2 text-gray-600">Loading ticket details...</p>
        </div>
      </div>
    );
  }

  if (hasError || !ticket) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-4">
        <div className="text-red-500 text-lg mb-2">Failed to load ticket</div>
        <p className="text-gray-600 mb-4 text-center">
          The ticket could not be found or you don't have permission to view it.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => navigate(-1)}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 flex items-center transition-colors"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Go Back
          </button>
          <button
            onClick={fetchTicket}
            className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 flex items-center transition-colors"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-4">
      <div className="space-y-4 bg-white px-5 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
              <button
                onClick={() => navigate(-1)}
                className="inline-flex items-center gap-2 text-slate-600 transition-colors hover:text-slate-900"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Tickets
              </button>
              <span className="font-mono text-slate-400">#{ticket.number}</span>
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-slate-950">
              {ticket.title}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                ticket.isComplete
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-amber-50 text-amber-700"
              }`}>
                {ticket.isComplete ? "Closed" : "Open"}
              </span>
              <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                ticket.priority === "high"
                  ? "bg-red-50 text-red-700"
                  : ticket.priority === "medium"
                    ? "bg-blue-50 text-blue-700"
                    : "bg-slate-100 text-slate-700"
              }`}>
                {(ticket.priority || "low").toUpperCase()}
              </span>
              <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                Assigned: {ticket.assignedTo?.name || "Unassigned"}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleRefresh}
              className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
              title="Refresh"
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <button
              onClick={handleCopyLink}
              className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
              title="Copy link"
            >
              <Copy className="h-4 w-4" />
              Copy Link
            </button>
            <button
              onClick={handleStatusUpdate}
              disabled={updating}
              className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-white transition-colors ${
                ticket.isComplete
                  ? "bg-slate-700 hover:bg-slate-800"
                  : "bg-emerald-600 hover:bg-emerald-700"
              } disabled:opacity-50`}
            >
              {updating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {ticket.isComplete ? "Reopen" : "Close Ticket"}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-5 border-b border-slate-200">
          {["activity", "details", "history"].map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`border-b-2 px-1 pb-3 pt-1 text-sm font-medium capitalize transition-colors ${
                activeTab === tab
                  ? "border-slate-900 text-slate-900"
                  : "border-transparent text-slate-500 hover:text-slate-900"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0 bg-white px-5 py-5">
          {activeTab === "activity" ? (
            <>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">Activity</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Customer conversation and agent replies.
                  </p>
                </div>
                <div className="text-sm text-slate-500">
                  {comments.length} comment{comments.length !== 1 ? "s" : ""}
                </div>
              </div>

              <div
                ref={chatRef}
                className="space-y-5 overflow-y-auto pr-1"
                style={{ maxHeight: "32rem" }}
              >
          {/* Original Ticket Description as first comment */}
                <div className="flex gap-3">
                  <div className="flex-shrink-0">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100">
                      <span className="text-sm font-medium text-slate-700">
                  {ticket.email?.[0]?.toUpperCase() || "C"}
                      </span>
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">
                        {ticket.email?.split('@')[0] || "Customer"}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                        Ticket Creator
                      </span>
                      <span className="text-xs text-slate-400">
                        {new Date(ticket.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="mt-3 rounded-md bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-700">
                      {ticket.detail}
                    </div>
                  </div>
                </div>

                {comments.length === 0 ? (
                  <div className="py-12 text-center">
                    <Mail className="mx-auto mb-3 h-12 w-12 text-slate-300" />
                    <p className="text-slate-500">No activity yet.</p>
                  </div>
                ) : (
                  comments.map((comment) => {
                    const isEmail = isEmailReply(comment);
                    const isOptimistic = comment.isOptimistic;
                    const senderName = getSenderName(comment);
                    const role = getCommentRole(comment);
                    const avatarClass = getAvatarColor(comment);
                    const messageClass = getMessageColor(comment);
                    const initials = getInitials(comment);
                    const commentKey = `${comment._id}-${comment.createdAt}`;

                    return (
                      <div key={commentKey} className="flex gap-3">
                        <div className="flex-shrink-0">
                          <div className={`flex h-10 w-10 items-center justify-center rounded-full ${avatarClass}`}>
                            <span className="text-sm font-medium">{initials}</span>
                          </div>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-slate-900">
                              {senderName}
                            </span>
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              isOptimistic
                                ? "bg-slate-100 text-slate-600"
                                : isEmail
                                  ? "bg-purple-50 text-purple-700"
                                  : comment.userId?._id === user?._id
                                    ? "bg-emerald-50 text-emerald-700"
                                    : "bg-blue-50 text-blue-700"
                            }`}>
                              {role}
                            </span>
                            <span className="text-xs text-slate-400">
                              {new Date(comment.createdAt).toLocaleString()}
                            </span>
                          </div>
                          <div className={`mt-3 rounded-md px-4 py-4 text-sm leading-6 text-slate-700 ${messageClass}`}>
                            <p className="whitespace-pre-wrap">
                              {comment.text}
                              {isOptimistic ? (
                                <span className="ml-2 inline-block">
                                  <Loader2 className="h-3 w-3 animate-spin text-slate-400" />
                                </span>
                              ) : null}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="mt-6 space-y-3">
                <div className="text-sm text-slate-500">
                  Reply will be sent to <span className="font-medium text-slate-900">{ticket.email}</span>
                </div>
                <textarea
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Write your reply"
                  className="min-h-[180px] w-full resize-none rounded-md bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-slate-900"
                  disabled={postingComment || ticket.isComplete}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (!postingComment && !ticket.isComplete) {
                        handleAddComment();
                      }
                    }
                  }}
                />
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-slate-500">
                    Shift + Enter for new line
                    {ticket.isComplete ? " • Ticket is closed" : ""}
                  </div>
                  <button
                    onClick={handleAddComment}
                    disabled={!newComment.trim() || postingComment || ticket.isComplete}
                    className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
                  >
                    {postingComment ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Send Reply
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold text-slate-950">Details</h2>
              <div className="grid gap-5 md:grid-cols-2">
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Customer</div>
                  <div className="text-sm text-slate-900">{ticket.email || "N/A"}</div>
                </div>
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Client</div>
                  <div className="text-sm text-slate-900">{ticket.client?.name || "N/A"}</div>
                </div>
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Created</div>
                  <div className="text-sm text-slate-900">{new Date(ticket.createdAt).toLocaleString()}</div>
                </div>
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Updated</div>
                  <div className="text-sm text-slate-900">{new Date(ticket.updatedAt || ticket.createdAt).toLocaleString()}</div>
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Description</div>
                <div className="rounded-md bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-700">
                  {ticket.detail}
                </div>
              </div>
            </div>
          )}

          {activeTab === "history" ? (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-slate-950">History</h2>
              <div className="space-y-4">
                <div className="rounded-md bg-slate-50 px-4 py-4">
                  <div className="text-sm font-medium text-slate-900">Ticket created</div>
                  <div className="mt-1 text-sm text-slate-600">{new Date(ticket.createdAt).toLocaleString()}</div>
                </div>
                <div className="rounded-md bg-slate-50 px-4 py-4">
                  <div className="text-sm font-medium text-slate-900">Status</div>
                  <div className="mt-1 text-sm text-slate-600">{ticket.isComplete ? "Closed" : "Open"}</div>
                </div>
                <div className="rounded-md bg-slate-50 px-4 py-4">
                  <div className="text-sm font-medium text-slate-900">Latest activity count</div>
                  <div className="mt-1 text-sm text-slate-600">{comments.length} recorded comment{comments.length !== 1 ? "s" : ""}</div>
                </div>
              </div>
            </div>
          ) : null}
        </section>

        <aside className="space-y-5 bg-white px-5 py-5">
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-950">Ticket Metadata</h2>
            <div className="space-y-3">
              <div>
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Ticket ID</div>
                <div className="mt-1 text-sm font-medium text-slate-900">#{ticket.number}</div>
              </div>
              <div>
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Assigned User</div>
                <div className="mt-1 text-sm text-slate-900">{ticket.assignedTo?.name || "Unassigned"}</div>
              </div>
              <div>
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Priority</div>
                <div className="mt-1 text-sm text-slate-900">{(ticket.priority || "low").toUpperCase()}</div>
              </div>
              <div>
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Status</div>
                <div className="mt-1 text-sm text-slate-900">{ticket.isComplete ? "Closed" : "Open"}</div>
              </div>
              <div>
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Customer Email</div>
                <div className="mt-1 break-all text-sm text-slate-900">{ticket.email}</div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default TicketDetail;
