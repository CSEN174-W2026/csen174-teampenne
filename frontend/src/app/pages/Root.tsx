import { Outlet, Link, useLocation, useNavigate } from "react-router";
import React from "react";
import { 
  LayoutDashboard, 
  Server, 
  Terminal, 
  
  Menu,
  X,
  Zap,
  Users,
  Network,
  Shield,
  Cpu
} from "lucide-react";
import { useState } from "react";
import { motion as Motion, AnimatePresence } from "motion/react";
import { useAuth } from "../auth/AuthContext";

export function Root() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const location = useLocation();
  const { user, isAdmin, logout } = useAuth();
  const nav = useNavigate();
  const canManageEc2 = (user?.email ?? "").trim().toLowerCase() === "shypine8@gmail.com";
  const neonPalette = [
    {
      border: "rgba(74, 222, 128, 0.95)", // green
      glow: "0 0 14px rgba(74,222,128,0.9), 0 0 30px rgba(74,222,128,0.45), inset 0 0 10px rgba(74,222,128,0.35)",
      fill: "rgba(10, 20, 14, 0.72)",
    },
    {
      border: "rgba(56, 189, 248, 0.95)", // blue
      glow: "0 0 14px rgba(56,189,248,0.9), 0 0 30px rgba(56,189,248,0.45), inset 0 0 10px rgba(56,189,248,0.35)",
      fill: "rgba(8, 16, 24, 0.72)",
    },
    {
      border: "rgba(192, 132, 252, 0.95)", // purple
      glow: "0 0 14px rgba(192,132,252,0.9), 0 0 30px rgba(192,132,252,0.45), inset 0 0 10px rgba(192,132,252,0.35)",
      fill: "rgba(22, 12, 26, 0.72)",
    },
    {
      border: "rgba(251, 146, 60, 0.95)", // orange
      glow: "0 0 14px rgba(251,146,60,0.9), 0 0 30px rgba(251,146,60,0.45), inset 0 0 10px rgba(251,146,60,0.35)",
      fill: "rgba(24, 14, 8, 0.72)",
    },
    {
      border: "rgba(250, 204, 21, 0.95)", // yellow
      glow: "0 0 14px rgba(250,204,21,0.9), 0 0 30px rgba(250,204,21,0.45), inset 0 0 10px rgba(250,204,21,0.35)",
      fill: "rgba(24, 20, 8, 0.72)",
    },
    {
      border: "rgba(248, 113, 113, 0.95)", // red
      glow: "0 0 14px rgba(248,113,113,0.9), 0 0 30px rgba(248,113,113,0.45), inset 0 0 10px rgba(248,113,113,0.35)",
      fill: "rgba(24, 10, 10, 0.72)",
    },
  ];
  const headerFloaters = [
    { top: "6%", size: 8, duration: 9, delay: 0.1 },
    { top: "10%", size: 16, duration: 18, delay: 0 },
    { top: "14%", size: 10, duration: 11, delay: 2.2 },
    { top: "18%", size: 7, duration: 8, delay: 1.5 },
    { top: "22%", size: 11, duration: 15, delay: 1.1 },
    { top: "26%", size: 9, duration: 10, delay: 0.7 },
    { top: "33%", size: 20, duration: 21, delay: 0.6 },
    { top: "38%", size: 6, duration: 7, delay: 3.1 },
    { top: "45%", size: 14, duration: 16, delay: 2.3 },
    { top: "50%", size: 9, duration: 12, delay: 1.9 },
    { top: "56%", size: 9, duration: 13, delay: 0.2 },
    { top: "61%", size: 13, duration: 17, delay: 2.9 },
    { top: "66%", size: 12, duration: 19, delay: 1.7 },
    { top: "71%", size: 8, duration: 9, delay: 0.5 },
    { top: "78%", size: 17, duration: 22, delay: 2.8 },
    { top: "82%", size: 9, duration: 10, delay: 1.3 },
    { top: "88%", size: 10, duration: 14, delay: 3.3 },
    { top: "93%", size: 7, duration: 8, delay: 2.5 },
    { top: "8%", size: 7, duration: 8.5, delay: 0.9 },
    { top: "16%", size: 12, duration: 12.5, delay: 1.4 },
    { top: "24%", size: 8, duration: 9.5, delay: 2.6 },
    { top: "31%", size: 15, duration: 14.5, delay: 0.4 },
    { top: "41%", size: 10, duration: 11.5, delay: 2.0 },
    { top: "54%", size: 7, duration: 8.8, delay: 3.0 },
    { top: "63%", size: 11, duration: 12.8, delay: 0.8 },
    { top: "74%", size: 9, duration: 10.2, delay: 1.6 },
    { top: "86%", size: 12, duration: 13.6, delay: 2.4 },
  ];

  const navItems = [
    { icon: LayoutDashboard, label: "Dashboard", path: "/" },
    { icon: Server, label: "Nodes", path: "/nodes" },
    { icon: Network, label: "Mesh", path: "/mesh" },
    // { icon: Activity, label: "Services", path: "/services" },
    { icon: Terminal, label: "System Logs", path: "/logs" },
    { icon: Zap, label: "Simulation", path: "/simulation" },
    ...(canManageEc2 ? [{ icon: Shield, label: "Admin Nodes", path: "/admin-nodes" }] : []),
    ...(isAdmin ? [{ icon: Users, label: "Manage Users", path: "/users" }] : []),
  ];

  return (
    <div className="flex h-screen bg-neutral-950 text-neutral-100 font-sans">
      {/* Sidebar */}
      <Motion.aside 
        initial={false}
        animate={{ width: isSidebarOpen ? 260 : 80 }}
        className="border-r border-neutral-800 bg-neutral-900/50 backdrop-blur-xl flex flex-col transition-all duration-300"
      >
        <div className="p-6 flex items-center gap-3">
          <Cpu className="w-7 h-7 text-white flex-shrink-0" />
          {isSidebarOpen && (
            <span className="font-bold text-2xl tracking-tight whitespace-nowrap">ARMSE</span>
          )}
        </div>

        <nav className="flex-1 px-4 py-6 space-y-2">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                location.pathname === item.path 
                  ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20" 
                  : "text-neutral-400 hover:text-white hover:bg-neutral-800"
              }`}
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              {isSidebarOpen && <span className="font-medium">{item.label}</span>}
            </Link>
          ))}
        </nav>

      </Motion.aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="relative h-16 overflow-hidden border-b border-neutral-800 bg-neutral-900/50 px-8 backdrop-blur-md">
          <div className="pointer-events-none absolute inset-0 z-0">
            <div className="absolute inset-0 bg-neutral-900/40" />
            {headerFloaters.map((block, idx) => {
              const color = neonPalette[idx % neonPalette.length];
              return (
                <Motion.div
                  key={`${block.top}-${idx}`}
                  className="absolute rounded-sm border"
                  style={{
                    left: "-14vw",
                    top: block.top,
                    width: block.size,
                    height: block.size,
                    borderColor: color.border,
                    backgroundColor: color.fill,
                    boxShadow: color.glow,
                  }}
                  initial={{ x: "0vw", opacity: 0 }}
                  animate={{ x: "130vw", opacity: [0, 0.92, 0.56, 0.92, 0] }}
                  transition={{
                    duration: block.duration,
                    delay: block.delay,
                    repeat: Infinity,
                    ease: "linear",
                  }}
                />
              );
            })}
          </div>

          <div className="relative z-10 flex h-full items-center justify-between">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 hover:bg-neutral-800 rounded-lg transition-colors"
            >
              {isSidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="flex -space-x-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <div className="w-2 h-2 rounded-full bg-emerald-500 blur-[2px]" />
              </div>
              <span className="text-xs font-medium text-emerald-500">SYSTEM HEALTHY</span>
            </div>
            
            <div
                onClick={() => nav("/profile")}
                className="flex items-center gap-3 border-l border-neutral-800 pl-6 cursor-pointer hover:bg-neutral-800/40 px-3 py-1 rounded-lg transition"
              >
              <div className="text-right">
                <p className="text-sm font-medium">{user?.full_name || user?.email || "User"}</p>
                <p className="text-xs text-neutral-500">{isAdmin ? "Admin" : "Member"}</p>
              </div>
              <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-sm font-bold">
                {(user?.full_name || user?.email || "U").slice(0, 2).toUpperCase()}
              </div>
              <button
                onClick={(e) => {
                    e.stopPropagation();
                    void logout();
                  }}
                  className="text-xs px-2 py-1 rounded border border-neutral-700 hover:bg-neutral-800"
              >
                Logout
              </button>
            </div>
          </div>
          </div>
        </header>

        {/* Viewport */}
        <div className="flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-indigo-500/5 via-transparent to-transparent">
          <div className="p-8 max-w-7xl mx-auto">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}
