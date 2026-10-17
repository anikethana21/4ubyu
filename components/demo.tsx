import React from 'react';
import { GlowCard } from "@/components/ui/spotlight-card";
import { Sparkles, Terminal, Code, Cpu, ExternalLink } from "lucide-react";

export function Default() {
  return (
    <div className="min-h-screen w-full bg-slate-950 flex flex-wrap items-center justify-center gap-8 p-10 select-none">
      {/* Blue Spotlight Card */}
      <GlowCard glowColor="blue" size="md">
        <div className="flex flex-col h-full justify-between z-10 text-slate-100">
          <div>
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-500/40 flex items-center justify-center mb-4 text-blue-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-lg text-white mb-2">Neural Synthesis</h3>
            <p className="text-sm text-slate-400 leading-relaxed">
              Real-time multi-agent transformer reasoning with deterministic timestamp grounding.
            </p>
          </div>
          <div className="flex items-center justify-between text-xs text-blue-400 font-medium pt-4 border-t border-white/10">
            <span>Explore Matrix</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </div>
        </div>
      </GlowCard>

      {/* Purple Spotlight Card */}
      <GlowCard glowColor="purple" size="md">
        <div className="flex flex-col h-full justify-between z-10 text-slate-100">
          <div>
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center mb-4 text-purple-400">
              <Terminal className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-lg text-white mb-2">Deep Code Extraction</h3>
            <p className="text-sm text-slate-400 leading-relaxed">
              Auto-discovers and formats clean executable algorithms directly from raw audio streams.
            </p>
          </div>
          <div className="flex items-center justify-between text-xs text-purple-400 font-medium pt-4 border-t border-white/10">
            <span>View Pipelines</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </div>
        </div>
      </GlowCard>

      {/* Orange Spotlight Card */}
      <GlowCard glowColor="orange" size="md">
        <div className="flex flex-col h-full justify-between z-10 text-slate-100">
          <div>
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center mb-4 text-amber-400">
              <Cpu className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-lg text-white mb-2">Swarm Architecture</h3>
            <p className="text-sm text-slate-400 leading-relaxed">
              Parallelized cluster orchestration powered by high-throughput LLM engines.
            </p>
          </div>
          <div className="flex items-center justify-between text-xs text-amber-400 font-medium pt-4 border-t border-white/10">
            <span>System Specs</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </div>
        </div>
      </GlowCard>
    </div>
  );
}

export default Default;
