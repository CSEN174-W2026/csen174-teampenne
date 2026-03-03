import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "./AuthContext";

export function RequireAuth() {
  const { loading, isAuthenticated } = useAuth();
  const location = useLocation();
  if (loading) return <div className="p-8 text-neutral-300">Loading session...</div>;
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

export function RequireAdmin() {
  const { loading, isAuthenticated, isAdmin } = useAuth();
  if (loading) return <div className="p-8 text-neutral-300">Loading session...</div>;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/" replace />;
  return <Outlet />;
}
