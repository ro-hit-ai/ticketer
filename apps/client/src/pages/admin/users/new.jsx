import React,{ useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import * as Switch from "@radix-ui/react-switch";
import { useUser } from "../../../store/session";

const NewUser = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [auth, setAuth] = useState(undefined);
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [admin, setAdmin] = useState(false);
  const [language, setLanguage] = useState("en");
  const { user, fetchWithAuth } = useUser();
  const navigate = useNavigate();

  async function checkAuth() {
    try {
      const response = await fetchWithAuth("/v1/auth/check", {
        method: "GET",
      });
      const data = await response.json();
      if (data.success) {
        setAuth(data.auth);
      } else {
        toast.error(`Authentication check failed: ${data.message || "Unknown error"}`, {
          toastId: "auth-check-error",
        });
        navigate("/auth/login");
      }
    } catch (error) {
      toast.error(`Authentication check failed: ${error.message}`, {
        toastId: "auth-check-error",
      });
      navigate("/auth/login");
    } finally {
      setIsLoading(false);
    }
  }

  async function createUser() {
    if (!name || !email) {
      toast.error("Name and email are required", {
        toastId: "create-user-error",
      });
      return;
    }

    try {
      const response = await fetchWithAuth("/v1/auth/user/register", {
        method: "POST",
        body: JSON.stringify({
          password,
          email,
          name,
          admin,
          language,
        }),
      });
      const data = await response.json();
      if (data.success) {
        toast.success("User created successfully");
        navigate("/admin/users");
      } else {
        toast.error(`Error creating user: ${data.message || "Unknown error"}`, {
          toastId: "create-user-error",
        });
      }
    } catch (error) {
      toast.error(`Error creating user: ${error.message}`, {
        toastId: "create-user-error",
      });
    }
  }

  useEffect(() => {
    checkAuth();
  }, [fetchWithAuth]);

  return (
    <div>
      <main className="flex-1">
        <div className="relative max-w-4xl mx-auto md:px-8 xl:px-0">
          <div className="pt-10 pb-6 divide-y-2">
            <div className="px-4 sm:px-6 md:px-0">
              <h1 className="text-3xl font-extrabold text-gray-900">
                Add a new user
              </h1>
            </div>
          </div>
          {isLoading ? (
            <div className="min-h-screen flex flex-col justify-center items-center py-12 sm:px-6 lg:px-8">
              <h2>Loading...</h2>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="w-1/2">
                <label className="text-gray-900 font-bold">Name</label>
                <input
                  type="text"
                  className="px-3 py-2 text-gray-900 bg-transparent border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-green-500 focus:border-green-500 block w-full sm:text-sm"
                  placeholder="John Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="w-1/2">
                <label className="text-gray-900 font-bold">Email</label>
                <input
                  type="email"
                  className="px-3 py-2 text-gray-900 bg-transparent border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-green-500 focus:border-green-500 block w-full sm:text-sm"
                  placeholder="John.Doe@test.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              {!user.sso_active && (
                <div className="w-1/2">
                  <label className="text-gray-900 font-bold">Password</label>
                  <input
                    type="password"
                    className="px-3 py-2 text-gray-900 bg-transparent border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-green-500 focus:border-green-500 block w-full sm:text-sm"
                    placeholder="Enter password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              )}
              <div className="w-1/2 flex flex-col">
                <label className="text-gray-900 font-bold">Language</label>
                <select
                  id="language"
                  name="language"
                  className="mt-1 text-gray-900 bg-transparent block w-full pl-3 pr-10 py-2 text-base border border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                >
                  <option value="en">English</option>
                  <option value="de">German</option>
                  <option value="se">Swedish</option>
                  <option value="es">Spanish</option>
                  <option value="no">Norwegian</option>
                  <option value="fr">French</option>
                  <option value="pt">Tagalog</option>
                  <option value="da">Danish</option>
                  <option value="pt">Portuguese</option>
                  <option value="it">Italian</option>
                  <option value="he">Hebrew</option>
                  <option value="tr">Turkish</option>
                  <option value="hu">Hungarian</option>
                  <option value="th">Thai (ภาษาไทย)</option>
                  <option value="zh-CN">Simplified Chinese (简体中文)</option>
                </select>
              </div>
              <div>
                <label className="text-gray-900 font-bold">Admin User</label>
                <div className="flex flex-row space-x-2 items-center">
                  <Switch.Root
                    checked={admin}
                    onCheckedChange={setAdmin}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full ${admin ? "bg-blue-600" : "bg-gray-200"}`}
                  >
                    <span className="sr-only">Admin user toggle</span>
                    <Switch.Thumb
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${admin ? "translate-x-6" : "translate-x-1"}`}
                    />
                  </Switch.Root>
                </div>
              </div>
              <div className="flex justify-end w-full">
                <button
                  type="button"
                  className="rounded-md bg-green-600 px-2.5 py-1.5 text-sm font-semibold text-white shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-green-500 disabled:bg-gray-300 disabled:cursor-not-allowed"
                  disabled={!name || !email}
                  onClick={createUser}
                >
                  Create User
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default NewUser;
