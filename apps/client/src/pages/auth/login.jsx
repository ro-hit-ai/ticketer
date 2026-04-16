// apps/client/src/pages/auth/login.jsx
import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import Cookies from "js-cookie";
import { toast } from "react-toastify";
import { useUser } from "../../store/session.jsx";
import { apiUrl } from "../../utils/api";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("idle");
  const [url, setUrl] = useState("");

  const { user, setUser } = useUser();
  const navigate = useNavigate();

  const isSubmitting = useRef(false);

  function getRedirectTarget(nextUser) {
    if (nextUser?.isAdmin) return "/admin";
    if (nextUser?.isAgent) return "/agents/tickets?status=open";
    return "/portal";
  }

  function normalizeUser(rawUser) {
    if (!rawUser) return null;

    return {
      ...rawUser,
      _id: rawUser.id || rawUser._id,
      id: rawUser.id || rawUser._id,
      isAdmin: rawUser.isAdmin === true,
      isAgent: rawUser.isAgent === true,
      imap_enabled: rawUser.imap_enabled === true,
    };
  }

  async function oidcLogin() {
    try {
      const res = await fetch(apiUrl("/v1/auth/check"), {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`OIDC check failed: ${res.status} ${text}`);
      }

      const data = await res.json();
      if (data.success && data.url) {
        setUrl(data.url);
      } else {
        toast.error(data.message || "SSO not configured.");
      }
    } catch (error) {
      toast.error(`Failed to check SSO: ${error.message}`);
    }
  }

  // Handle form submit
  async function postData(e) {
    e.preventDefault();
    if (status === "loading" || isSubmitting.current) return;

    isSubmitting.current = true;
    setStatus("loading");

    try {
      const res = await fetch(apiUrl("/v1/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Login failed: ${res.status} ${text}`);
      }

      const data = await res.json();
      if (data.token && data.user) {
        const normalizedUser = normalizeUser(data.user);

        Cookies.set("session", data.token, {
          secure: window.location.protocol === "https:",
          sameSite: "lax",
          path: "/",
          expires: 7,
        });
        localStorage.setItem("session", data.token);

        setUser(normalizedUser);
        localStorage.setItem("user", JSON.stringify(normalizedUser));
        navigate(getRedirectTarget(normalizedUser), { replace: true });
        toast.success("Login successful! Welcome back.");
      } else {
        toast.error(data.message || "Invalid login");
      }
    } catch (error) {
      toast.error(`Login failed: ${error.message}`);
    } finally {
      setStatus("idle");
      isSubmitting.current = false;
    }
  }

  useEffect(() => {
    if (user) {
      navigate(getRedirectTarget(user), { replace: true });
      return;
    }

    oidcLogin();
  }, [user, navigate]);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-6 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-md">
        <h2 className="mt-6 text-center text-2xl sm:text-3xl font-extrabold text-gray-900">
          Welcome to Peppermint
        </h2>
      </div>
      <div className="mt-8 mx-auto w-full max-w-md">
        {status === "loading" ? (
          <div className="text-center">Loading...</div>
        ) : (
          <div className="bg-white py-6 px-4 shadow rounded-lg sm:px-10">
            <form onSubmit={postData} className="space-y-4">
              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-gray-900"
                >
                  Email address
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-gray-900"
                >
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="off"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm"
                />
              </div>
              <button
                type="submit"
                disabled={!email || !password || status === "loading"}
                className="w-full flex justify-center py-2 px-4 bg-green-600 text-white rounded-md"
              >
                Sign In
              </button>
              {url && (
                <button
                  type="button"
                  onClick={() => (window.location.href = url)}
                  className="w-full flex justify-center py-2 px-4 bg-white text-gray-900 rounded-md border"
                >
                  Sign in with OIDC
                </button>
              )}
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
