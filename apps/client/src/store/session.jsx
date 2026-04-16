// src/store/session.jsx
import React, { useState, useEffect, useCallback, useContext, createContext, useRef } from "react";
import Cookies from "js-cookie";
import { apiUrl } from "../utils/api";

const SessionContext = createContext(null);

export const SessionProvider = ({ children }) => {
  const refreshInProgress = useRef(false);
  const initInProgress = useRef(false);
  const storedUser = (() => {
    try {
      const rawUser = localStorage.getItem("user");
      return rawUser ? JSON.parse(rawUser) : null;
    } catch {
      return null;
    }
  })();
  const storedToken =
    (typeof window !== "undefined" &&
      (Cookies.get("session") || localStorage.getItem("session"))) ||
    null;

  const [user, setUser] = useState(storedUser);
  const [status, setStatus] = useState(
    storedUser ? "authenticated" : storedToken ? "loading" : "unauthenticated"
  ); // "loading" | "authenticated" | "unauthenticated"
  const [error, setError] = useState(null);

  // -----------------------------------------------------------------
  // LOGOUT
  // -----------------------------------------------------------------
  const logout = useCallback(() => {
    Cookies.remove("session", { path: "/" });
    localStorage.removeItem("session");
    localStorage.removeItem("user");
    setUser(null);
    setStatus("unauthenticated");
    setError(null);
  }, []);

  // -----------------------------------------------------------------
  // HANDLE PROFILE RESPONSE
  // -----------------------------------------------------------------
  const handleProfileResponse = async (response) => {
    if (!response.ok) {
      if (response.status === 401) {
        logout(true);
        return null;
      }
      throw new Error(`Profile fetch failed: ${response.status}`);
    }

    const data = await response.json();

    if (data.user) {
      const normalizedUser = {
        ...data.user,
        _id: data.user.id || data.user._id, // ← CRITICAL
        id: data.user.id,
        isAdmin: data.user.isAdmin === true,
        isAgent: data.user.isAgent === true,
        imap_enabled: data.user.imap_enabled === true,
      };

      setUser(normalizedUser);
      localStorage.setItem("user", JSON.stringify(normalizedUser));
      setStatus("authenticated");

      if (data.token) {
        Cookies.set("session", data.token, { sameSite: "lax" });
      }
      return normalizedUser;
    } else {
      throw new Error(data.message || "Invalid profile data");
    }
  };

  // -----------------------------------------------------------------
  // REFRESH SESSION
  // -----------------------------------------------------------------
  const refreshSession = useCallback(async () => {
    if (refreshInProgress.current) return null;
    refreshInProgress.current = true;

    let token = Cookies.get("session") || localStorage.getItem("session");
    if (!token) {
      setStatus("unauthenticated");
      refreshInProgress.current = false;
      return null;
    }
    // Ensure cookie exists even if token came from localStorage (domain mismatch fix)
    if (!Cookies.get("session")) {
      Cookies.set("session", token, {
        secure: window.location.protocol === "https:",
        sameSite: "lax",
        path: "/",
        expires: 7,
      });
    }

    try {
      setStatus((currentStatus) =>
        currentStatus === "authenticated" ? currentStatus : "loading"
      );
      const response = await fetch(apiUrl("/v1/auth/profile"), {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        credentials: "include",
      });

      const result = await handleProfileResponse(response);
      refreshInProgress.current = false;
      return result;
    } catch (err) {
      console.error("refreshSession failed:", err);
      setStatus((currentStatus) => (currentStatus === "authenticated" ? currentStatus : "unauthenticated"));
      setError(err);
      refreshInProgress.current = false;
      return null;
    }
  }, [logout]);

  // -----------------------------------------------------------------
  // SINGLE useEffect: INIT SESSION ONCE
  // -----------------------------------------------------------------
  useEffect(() => {
    let isMounted = true;

    const initSession = async () => {
      if (initInProgress.current) return;
      initInProgress.current = true;
      let token = Cookies.get("session") || localStorage.getItem("session");

      if (!token) {
        if (isMounted) {
          setStatus("unauthenticated");
        }
        initInProgress.current = false;
        return;
      }
      if (!Cookies.get("session")) {
        Cookies.set("session", token, {
          secure: window.location.protocol === "https:",
          sameSite: "lax",
          path: "/",
          expires: 7,
        });
      }

      try {
        setStatus("loading");
        setError(null);
        const response = await fetch(apiUrl("/v1/auth/profile"), {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          credentials: "include",
        });

        if (!isMounted) return;

        if (response.status === 401) {
          Cookies.remove("session", { path: "/" });
          localStorage.removeItem("session");
          localStorage.removeItem("user");
          setStatus("unauthenticated");
          return;
        }

        if (!response.ok) {
          throw new Error(`Profile fetch failed: ${response.status}`);
        }

        await handleProfileResponse(response);
      } catch (err) {
        if (isMounted) {
          console.error("Session init failed:", err);
          setError(err);
          setStatus("unauthenticated");
        }
      } finally {
        initInProgress.current = false;
      }
    };

    initSession();

    return () => {
      isMounted = false;
    };
  }, []);

  // -----------------------------------------------------------------
  // FETCH WITH AUTH
  // -----------------------------------------------------------------
  const fetchWithAuth = useCallback(
    async (url, options = {}) => {
      let token = Cookies.get("session");
      if (!token) throw new Error("No session");

      const doFetch = async (authToken) => {
        return fetch(apiUrl(url), {
          ...options,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
            ...(options.headers || {}),
          },
          credentials: "include",
        });
      };

      let res = await doFetch(token);

      if (res.status === 401) {
        const refreshed = await refreshSession();
        if (!refreshed) throw new Error("Session expired");
        token = Cookies.get("session");
        res = await doFetch(token);
      }

      return res;
    },
    [refreshSession]
  );

  // -----------------------------------------------------------------
  // CONTEXT VALUE
  // -----------------------------------------------------------------
  const loading = status === "loading";
  const contextValue = {
    user,
    setUser,
    status,
    loading,
    error,
    isAdmin: user?.isAdmin || false,
    isAgent: user?.isAgent || false,
    imap_enabled: loading ? false : !!user?.imap_enabled,
    refreshSession,
    logout,
    fetchWithAuth,
  };

  return (
    <SessionContext.Provider value={contextValue}>
      {children}
    </SessionContext.Provider>
  );
};

// -----------------------------------------------------------------
// useUser: BLOCK UNTIL READY
// -----------------------------------------------------------------
export const useUser = () => {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useUser must be used within SessionProvider");
  return ctx;
};
