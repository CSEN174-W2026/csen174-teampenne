import { Activity, Layers, Play, Square, RefreshCcw, MoreVertical } from "lucide-react";

export function Services() {
  const services = [
    { name: "Auth Service", version: "v2.4.1", status: "Running", instances: 12, health: 100, latency: "12ms" },
    { name: "Payment Gateway", version: "v1.8.9", status: "Running", instances: 8, health: 98, latency: "45ms" },
    { name: "User Profile API", version: "v3.0.2", status: "Degraded", instances: 6, health: 74, latency: "210ms" },
    { name: "Notification Engine", version: "v1.2.4", status: "Running", instances: 4, health: 100, latency: "8ms" },
    { name: "Data Warehouse Sync", version: "v4.1.0", status: "Stopped", instances: 0, health: 0, latency: "-" },
    { name: "Search Indexer", version: "v2.2.0", status: "Running", instances: 10, health: 100, latency: "34ms" },
  ];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white">Service Mesh</h1>
        <p className="text-neutral-400 mt-1">Status and metrics for individual microservices.</p>
      </div>

      <div className="bg-neutral-900/40 border border-neutral-800 rounded-2xl overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-neutral-800/30 text-neutral-400 text-xs uppercase tracking-wider font-bold">
              <th className="px-6 py-4">Service</th>
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4 text-center">Instances</th>
              <th className="px-6 py-4">Health</th>
              <th className="px-6 py-4">Latency</th>
              <th className="px-6 py-4 text-right">Controls</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800">
            {services.map((svc) => (
              <tr key={svc.name} className="hover:bg-neutral-800/30 transition-colors group">
                <td className="px-6 py-5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-neutral-800 flex items-center justify-center text-indigo-400">
                      <Layers className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-white">{svc.name}</h3>
                      <p className="text-xs text-neutral-500">{svc.version}</p>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-5">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                    svc.status === 'Running' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 
                    svc.status === 'Degraded' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                    'bg-neutral-800 text-neutral-500 border-neutral-700'
                  }`}>
                    {svc.status}
                  </span>
                </td>
                <td className="px-6 py-5 text-center font-mono text-neutral-300">{svc.instances}</td>
                <td className="px-6 py-5">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-neutral-800 rounded-full min-w-[60px]">
                      <div 
                        className={`h-full rounded-full ${svc.health > 90 ? 'bg-emerald-500' : svc.health > 50 ? 'bg-amber-500' : 'bg-rose-500'}`} 
                        style={{ width: `${svc.health}%` }} 
                      />
                    </div>
                    <span className="text-xs font-medium text-neutral-400">{svc.health}%</span>
                  </div>
                </td>
                <td className="px-6 py-5 font-mono text-sm text-neutral-400">{svc.latency}</td>
                <td className="px-6 py-5 text-right">
                  <div className="flex items-center justify-end gap-2">
                    {svc.status === 'Stopped' ? (
                      <button className="p-2 text-emerald-500 hover:bg-emerald-500/10 rounded-lg transition-colors" title="Start Service">
                        <Play className="w-4 h-4 fill-current" />
                      </button>
                    ) : (
                      <button className="p-2 text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors" title="Stop Service">
                        <Square className="w-4 h-4 fill-current" />
                      </button>
                    )}
                    <button className="p-2 text-neutral-400 hover:bg-neutral-800 rounded-lg transition-colors" title="Restart Service">
                      <RefreshCcw className="w-4 h-4" />
                    </button>
                    <button className="p-2 text-neutral-400 hover:bg-neutral-800 rounded-lg transition-colors">
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
