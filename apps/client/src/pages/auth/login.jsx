// apps/client/src/pages/auth/login.jsx
import React, { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
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
    <div className="relative min-h-screen overflow-hidden bg-slate-950 px-4 py-8 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 top-[-120px] h-80 w-80 rounded-full bg-emerald-400/30 blur-3xl" />
        <div className="absolute right-[-120px] top-1/4 h-96 w-96 rounded-full bg-cyan-400/20 blur-3xl" />
        <div className="absolute bottom-[-140px] left-1/3 h-96 w-96 rounded-full bg-lime-300/20 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-[92vh] w-full max-w-6xl items-center justify-center">
        <div className="grid w-full overflow-hidden rounded-3xl border border-white/20 bg-white/10 shadow-2xl backdrop-blur-xl md:grid-cols-2">
          <div className="hidden flex-col justify-between bg-gradient-to-br from-emerald-500/90 via-emerald-600/85 to-teal-700/85 p-10 text-white md:flex">
            <div>
              <p className="inline-flex rounded-full border border-white/35 bg-white/10 px-3 py-1 text-xs font-semibold tracking-wide uppercase">
                Peppermint Helpdesk
              </p>
              <h1 className="mt-6 text-4xl font-bold leading-tight">
                Delight every customer with faster support.
              </h1>
              <p className="mt-4 max-w-sm text-sm text-emerald-50/90">
                Secure access for your team with role-based workflows, inboxes, and live ticket collaboration.
              </p>
            </div>
            <p className="text-sm text-emerald-50/90">Trusted by support teams that move quickly.</p>
          </div>

          <div className="bg-white p-6 sm:p-8 md:p-10">
            <div className="mx-auto w-full max-w-md">
              <h2 className="text-3xl font-black tracking-tight text-slate-900">Welcome back</h2>
              <p className="mt-2 text-sm text-slate-500">Sign in to continue to your workspace.</p>

              {status === "loading" ? (
                <div className="mt-8 rounded-xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-medium text-slate-600">
                  Signing you in...
                </div>
              ) : (
                <form onSubmit={postData} className="mt-8 space-y-5">
                  <div>
                    <label htmlFor="email" className="mb-2 block text-sm font-semibold text-slate-700">
                      Email address
                    </label>
                    <input
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/15"
                    />
                  </div>
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <label htmlFor="password" className="block text-sm font-semibold text-slate-700">
                        Password
                      </label>
                      <Link to="/auth/forgot-password" className="text-xs font-semibold text-emerald-700 hover:text-emerald-800">
                        Forgot password?
                      </Link>
                    </div>
                    <input
                      id="password"
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/15"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={!email || !password || status === "loading"}
                    className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    Sign In
                  </button>

                  {url && (
                    <button
                      type="button"
                      onClick={() => (window.location.href = url)}
                      className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 transition hover:border-slate-400 hover:bg-slate-50"
                    >
                      Continue with SSO
                    </button>
                  )}
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
