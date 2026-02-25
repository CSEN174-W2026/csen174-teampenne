import { Link } from "react-router";
import { Ghost, Home } from "lucide-react";

export function NotFound() {
  return (
    <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center p-6 text-center">
      <div className="w-24 h-24 bg-indigo-500/10 rounded-full flex items-center justify-center mb-8 animate-bounce">
        <Ghost className="w-12 h-12 text-indigo-400" />
      </div>
      <h1 className="text-6xl font-black text-white mb-4 tracking-tight">404</h1>
      <p className="text-xl text-neutral-400 mb-8 max-w-md">
        The system node you are looking for has been decommissioned or moved to another cluster.
      </p>
      <Link 
        to="/" 
        className="flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold transition-all transform hover:scale-105 active:scale-95"
      >
        <Home className="w-5 h-5" />
        Return to Command Center
      </Link>
    </div>
  );
}
