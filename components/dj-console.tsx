/** Matched decks and mixer share one projected control plane. Decorative only. */
function Deck({ x }: { x: number }) {
  return <g data-dj-deck transform={`translate(${x} 0)`}>
    <rect width="104" height="76" rx="3" fill="#151517" stroke="#717177" strokeWidth=".8" />
    <path d="M3 75H101V79H3Z" fill="#09090b" stroke="#444449" strokeWidth=".6" />
    <rect x="8" y="6" width="64" height="14" rx="1" fill="#08080a" stroke="#55555c" strokeWidth=".7" />
    <path d="M11 12h5l2-3 2 7 3-5h5l2 5 2-8 2 4h5l2-3 2 7 3-5h6l2 3 2-4h10" fill="none" stroke="#d8d8dd" strokeWidth=".8" />
    <path d="M40 7V19" stroke="#ff263e" />
    <path d="M11 17H35M44 17H68" stroke="#77777f" strokeWidth=".6" />
    <circle cx="84" cy="10" r="3.2" fill="#28282d" stroke="#a3a3ab" strokeWidth=".8" />
    <path d="M84 7v2" stroke="#eeeef1" />
    <rect x="81" y="17" width="15" height="4" rx="1" fill="#3c3c43" />
    <circle cx="46" cy="43" r="24" fill="#09090b" stroke="#d5d5dc" strokeWidth="1.2" />
    <circle cx="46" cy="43" r="20.5" fill="#25252a" stroke="#65656e" strokeWidth=".8" />
    <g transform="translate(46 43)">
      <circle className="deck-ring" r="22" fill="none" stroke="#ff263e" strokeWidth="1.6" strokeDasharray="12 126" />
      <circle r="10" fill="#111114" stroke="#777780" strokeWidth=".7" />
      <path d="M0-7V-3" stroke="#f4f4f5" strokeWidth="1.4" />
    </g>
    <circle cx="10" cy="37" r="4" fill="#27272d" stroke="#c9c9d0" strokeWidth=".8" />
    <circle cx="10" cy="53" r="4.5" fill="#ff263e" stroke="#ff9aa6" strokeWidth=".6" />
    <path d="M9 50l3 3-3 3Z" fill="#fff" />
    <path d="M89 29V61M85 29H93M85 61H93" stroke="#7a7a84" strokeWidth=".8" />
    {[35, 43, 51, 57].map(y => <path key={y} d={`M92 ${y}h3`} stroke="#74747d" strokeWidth=".6" />)}
    <rect x="85" y="43" width="8" height="5" rx=".6" fill="#cacad1" stroke="#09090b" strokeWidth=".7" />
    <path d="M86 45.5H92" stroke="#ff263e" strokeWidth=".8" />
    {[0, 1, 2, 3].map(index => <rect key={index} x={24 + index * 13} y="69" width="10" height="4" rx=".6"
      fill={index === 0 ? "#ff263e" : "#94949d"} />)}
  </g>;
}

export function DJConsole({ prefix }: { prefix: string }) {
  return <g className="dj-booth">
    <path d="M645 466L666 419H986L1007 466Z" fill="#27272d" stroke="#77777f" />
    <path d="M645 466H1007L986 564H665Z" fill={`url(#${prefix}-booth-front)`} stroke="#45454d" />
    <path d="M657 474H995" stroke="#ff263e" strokeWidth="2" />
    <path d="M667 552H985M674 481L681 546M978 481L971 546" fill="none" stroke="#3d3d46" />
    <g className="dj-control-plane" transform="translate(674 423) scale(1 .46)">
      <g className="dj-decks"><Deck x={0} /><Deck x={200} /></g>
      <g className="dj-mixer">
        <rect x="116" width="72" height="79" rx="2" fill="#101012" stroke="#8d8d96" strokeWidth=".8" />
        {[125, 137, 149, 161].map((x, channel) => <g key={x} data-mixer-channel>
          <path d={`M${x - 5} 4V65`} stroke="#34343b" strokeWidth=".6" />
          {[8, 20, 31, 42].map((y, knob) => <g key={y}>
            <circle cx={x} cy={y} r="2.8" fill="#333339" stroke="#a4a4ad" strokeWidth=".6" />
            <path d={`M${x} ${y - 2}v1.4`} stroke={knob === 0 ? "#ff263e" : "#eeeeef"} strokeWidth=".7" />
          </g>)}
          <path d={`M${x} 49V65`} stroke="#777781" strokeWidth="1" />
          <rect x={x - 3.5} y={52 + channel % 3 * 3} width="7" height="4" rx=".5" fill="#d8d8df" stroke="#151518" strokeWidth=".6" />
        </g>)}
        <circle cx="178" cy="8" r="3" fill="#55555f" stroke="#c1c1c9" strokeWidth=".7" />
        {[0, 1].map(column => <g key={column}>
          {Array.from({ length: 9 }, (_, row) => <rect key={row} className="mixer-meter"
            x={173 + column * 6} y={20 + row * 4} width="3" height="2"
            fill={row < 2 ? "#ff263e" : "#c5c5ce"} style={{ animationDelay: `${row * -.13}s` }} />)}
        </g>)}
        <path d="M132 72H163" stroke="#767680" strokeWidth="1.2" />
        <rect x="145" y="69" width="5" height="6" rx=".5" fill="#d9d9e0" stroke="#09090b" strokeWidth=".7" />
        <path d="M147.5 70V74" stroke="#ff263e" strokeWidth=".7" />
      </g>
    </g>
    <text x="826" y="528" textAnchor="middle" fill="#eeeeef" fontFamily="Afterparty, Arial, sans-serif"
      fontSize="18" fontWeight="900" letterSpacing="-.5">afterparty<tspan fill="#ff263e">.</tspan></text>
  </g>;
}
