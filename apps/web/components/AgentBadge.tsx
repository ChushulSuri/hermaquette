interface AgentBadgeProps {
  agent?: string  // e.g. "Hermaquette", "Sculptor", "Follow-up"
}

export function AgentBadge({ agent }: AgentBadgeProps) {
  if (!agent) return null
  return (
    <span className="text-xs font-mono bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded ml-2">
      {agent}
    </span>
  )
}
