import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { useAuth } from "../auth/AuthContext";

export function Login() {
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const { login, signup, isAuthenticated, loading } = useAuth();
  const [isSignup, setIsSignup] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!loading && isAuthenticated) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-6 space-y-5">
        <div>
          <h1 className="text-2xl font-bold">{isSignup ? "Create account" : "Sign in"}</h1>
          <p className="text-sm text-neutral-400 mt-1">
            {isSignup ? "Create a Firebase account to access the platform." : "Sign in with your Firebase account."}
          </p>
        </div>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            setSubmitting(true);
            void (isSignup ? signup(email, password, fullName) : login(email, password))
              .then(() => {
                const target = location.state?.from || "/";
                navigate(target, { replace: true });
              })
              .catch((err: unknown) => {
                const msg = err instanceof Error ? err.message : "Login failed";
                setError(msg);
              })
              .finally(() => setSubmitting(false));
          }}
        >
          {isSignup ? (
            <label className="block text-sm space-y-1">
              <span className="text-neutral-300">Full name</span>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2"
                placeholder="Jane Doe"
              />
            </label>
          ) : null}

          <label className="block text-sm space-y-1">
            <span className="text-neutral-300">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2"
              required
            />
          </label>

          <label className="block text-sm space-y-1">
            <span className="text-neutral-300">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2"
              required
            />
          </label>

          {error ? (
            <div className="text-xs text-rose-300 border border-rose-800 rounded-lg px-3 py-2">{error}</div>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-4 py-2 font-medium"
          >
            {submitting ? (isSignup ? "Creating..." : "Signing in...") : isSignup ? "Create account" : "Sign in"}
          </button>

          <button
            type="button"
            onClick={() => {
              setError(null);
              setIsSignup((p) => !p);
            }}
            className="w-full rounded-lg border border-neutral-700 hover:bg-neutral-800 px-4 py-2 text-sm"
          >
            {isSignup ? "Already have an account? Sign in" : "Need an account? Create one"}
          </button>
        </form>
      </div>
    </div>
  );
}
