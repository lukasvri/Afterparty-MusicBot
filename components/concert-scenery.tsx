import { memo, useId } from "react";
import { DJConsole } from "./dj-console";

/** Opaque flown cabinets, with inward-facing rigging and grille detail. */
function ConcertPA({ prefix, right = false }: { prefix: string; right?: boolean }) {
  return <g data-pa-array transform={`translate(${right ? 1178 : 472} 0)${right ? " scale(-1 1)" : ""}`}>
    <g fill="none" stroke="#777780" strokeWidth="2">
      <path d="M12 57V124M62 57V124" />
      <path d="M37 57L44 124" stroke="#4f4f58" strokeWidth="1" />
    </g>
    <path d="M-5 124H82V137H-5Z" fill="#29292f" stroke="#777780" />
    {[12, 62].map(x => <circle key={x} cx={x} cy="125" r="3" fill="#09090c" stroke="#b2b2ba" />)}
    {Array.from({ length: 7 }, (_, index) => <g key={index}
      transform={`translate(${index * index * .18} ${141 + index * 29}) rotate(${index * .65} 37 0)`}>
      <path d="M0 0H74L86 5V29L74 25L0 28Z" fill="#0c0c10" stroke="#6b6b74" strokeWidth="1" />
      <path d="M74 0V25L86 29V5Z" fill="#222228" stroke="#55555e" strokeWidth=".7" />
      <rect x="4" y="3" width="66" height="19" rx="1" fill="#18181d" stroke="#45454e" strokeWidth=".6" />
      <rect x="4" y="3" width="66" height="19" rx="1" fill={`url(#${prefix}-pa-grille)`} />
      <path d="M16 12H58" stroke="#42424b" strokeWidth=".8" />
      <path d="M78 8V19" stroke="#09090c" strokeWidth="2.5" />
      <path d="M-2 20V31M73 22V32" stroke="#96969f" strokeWidth="1.4" />
      <circle cx="1" cy="25" r="1.3" fill="#b7b7bf" />
      <circle cx="73" cy="24" r="1.3" fill="#b7b7bf" />
    </g>)}
  </g>;
}

function GroundSubs({ prefix, x }: { prefix: string; x: number }) {
  return <g data-pa-subs transform={`translate(${x} 513)`}>
    <path d="M0 10L10 0H122V56L112 66H0Z" fill="#101014" stroke="#65656e" />
    <path d="M0 10H112L122 0H10ZM112 10V66L122 56V0Z" fill="#222228" stroke="#4f4f59" />
    {[7, 60].map(left => <g key={left}>
      <rect x={left} y="17" width="45" height="38" rx="1" fill="#19191e" stroke="#45454d" strokeWidth=".7" />
      <rect x={left} y="17" width="45" height="38" rx="1" fill={`url(#${prefix}-pa-grille)`} />
      <path d={`M${left + 4} 60h37`} stroke="#050507" strokeWidth="3" />
    </g>)}
    <path d="M6 66V70M105 66V70" stroke="#070709" strokeWidth="4" />
  </g>;
}
/** SVG paint order keeps scenery behind the performer and hands above the decks. */
export const ConcertScenery = memo(function ConcertScenery({
  composition = "room",
}: {
  composition?: "room" | "welcome";
}) {
  const prefix = useId().replace(/:/g, "");
  const lamps=[100,300,500,700,900,1100];
  // Rooms leave space for their empty-state controls; the welcome scene has its own centre.
  const stageOffset = composition === "welcome" ? -225 : 0;
  return <div className="concert-scenery" data-composition={composition} aria-hidden="true">
    <svg className="concert-venue" viewBox="0 0 1200 675" preserveAspectRatio={composition === "welcome" ? "xMidYMid slice" : "xMidYMid meet"} focusable="false">
      <defs>
        <radialGradient id={`${prefix}-venue-glow`}><stop stopColor="#4c1822"/><stop offset=".55" stopColor="#191217"/><stop offset="1" stopColor="#09090c"/></radialGradient>
        <linearGradient id={`${prefix}-warm-beam`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#ff263e" stopOpacity=".3"/><stop offset=".45" stopColor="#ff263e" stopOpacity=".08"/><stop offset="1" stopColor="#ff263e" stopOpacity="0"/></linearGradient>
        <linearGradient id={`${prefix}-cool-beam`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#eeeeef" stopOpacity=".32"/><stop offset=".5" stopColor="#d3d3db" stopOpacity=".08"/><stop offset="1" stopColor="#eeeeef" stopOpacity="0"/></linearGradient>
        <linearGradient id={`${prefix}-booth-front`} x1="0" x2="0" y1="0" y2="1"><stop stopColor="#26262b"/><stop offset="1" stopColor="#0d0d10"/></linearGradient>
        <linearGradient id={`${prefix}-laser-fade`}><stop stopColor="#ff6576" stopOpacity=".7"/><stop offset="1" stopColor="#ff263e" stopOpacity=".1"/></linearGradient>
        <linearGradient id={`${prefix}-stage-floor`} x1="0" x2="0" y1="0" y2="1"><stop stopColor="#4f1a25" stopOpacity=".2"/><stop offset="1" stopColor="#09090d"/></linearGradient>
        <pattern id={`${prefix}-led-grid`} width="10" height="10" patternUnits="userSpaceOnUse"><circle cx="5" cy="5" r="1" fill="#f2a5c3" opacity=".12"/></pattern>
        <pattern id={`${prefix}-pa-grille`} width="4" height="4" patternUnits="userSpaceOnUse"><path d="M0 1H4M0 3H4" stroke="#34343c" strokeWidth=".65" /></pattern>
        <clipPath id={`${prefix}-led-screen`} clipPathUnits="userSpaceOnUse"><rect x="566" y="121" width="518" height="368" /></clipPath>
      </defs>
      <rect width="1200" height="675" fill={`url(#${prefix}-venue-glow)`}/>
      <g className="stage-backdrop" transform={`translate(${stageOffset} 0)`}>
      <path data-led-screen d="M560 115H1090V495H560Z" fill="#111114" stroke="#55555e"/>
      <g clipPath={`url(#${prefix}-led-screen)`}>
      <rect x="566" y="121" width="518" height="368" fill={`url(#${prefix}-led-grid)`}/>
      <g className="led-halo" data-led-halo transform={`translate(825 ${composition === "welcome" ? 278 : 300})`} fill="none"><circle r="136" stroke="#ff263e" strokeWidth="2" opacity=".32"/><circle className="led-orbit" r="124" stroke="#ff4357" strokeWidth="6" strokeDasharray="24 28" opacity=".4"/><circle className="led-orbit-inner" r="110" stroke="#c6c6ce" strokeWidth="2" strokeDasharray="100 28" opacity=".3"/>{Array.from({length:36},(_,i)=><path key={i} d="M0-144V-153" transform={`rotate(${i*10})`} stroke={i%3?'#ff263e':'#c6c6ce'} strokeWidth="2" opacity=".25"/>)}</g>
      <image href="/afterparty-mark.svg" x="725" y={composition === "welcome" ? 100 : 185} width="200" height="200" opacity=".8"/>
      <g className="stage-led-bars" fill="#ed577f">{Array.from({length:23},(_,i)=><rect key={i} x={585+i*20} y={425-(i%5)*11} width="8" height={25+(i%5)*11} rx="2" style={{animationDelay:`${i*-.14}s`}}/>)}</g>
      </g>
      </g>
      <g className="stage-light-bank">{lamps.map((x,i)=><g key={x} transform={`translate(${x} 85)`}><g className={`rig-beam ${i%2?'rig-beam-even':'rig-beam-odd'}`}><path d="M-4 0H4L98 490H-98Z" fill={i%2?`url(#${prefix}-cool-beam)`:`url(#${prefix}-warm-beam)`}/></g></g>)}</g>
      <g className="stage-truss" fill="none" stroke="#77717e" strokeWidth="2"><path d="M0 28H1200M0 57H1200"/>{Array.from({length:20},(_,i)=><path key={i} d={`M${i*60} 28l30 29 30-29`}/>)}</g>
      <g className="stage-fixtures">{lamps.map((x,i)=><g key={x} transform={`translate(${x} 57)`}><path d="M-12 0V12H12V0M0 12V19" stroke="#aaaab3" strokeWidth="3" fill="none"/><rect x="-17" y="16" width="34" height="14" rx="3" fill="#242429" stroke="#65656e"/><rect x="-8" y="24" width="16" height="4" rx="2" fill={i%2?'#eeeeef':'#ff5367'}/></g>)}</g>
      <path d="M0 500H1200V675H0Z" fill={`url(#${prefix}-stage-floor)`}/>
      <g stroke="#65656e" strokeWidth="1" opacity=".12"><path d="M0 500H1200M0 540H1200M0 610H1200M420 500L0 675M540 500L400 675M660 500L800 675M780 500L1200 675"/></g>
      <ellipse className="stage-mist" cx={825 + stageOffset} cy="490" rx="360" ry="65" fill="#b0b0ba" opacity=".035"/>
      <g className="stage-production" transform={`translate(${stageOffset} 0)`}>
      {[{ x:630, direction:1 }, { x:1020, direction:-1 }].map(({ x,direction }) => <g key={x} transform={`translate(${x} 506)`}>
        <g className={`laser-fan ${direction === 1 ? "laser-fan-left" : "laser-fan-right"}`} fill="none" stroke={`url(#${prefix}-laser-fade)`} strokeWidth="1">
          {[0,1,2].map(index => <path key={index} d={`M0 0L${direction * (210 + index * 110)} ${-370 + index * 80}`} />)}
        </g>
        <rect x="-12" y="-7" width="24" height="14" rx="3" fill="#202025" stroke="#55555e" strokeWidth=".8"/><circle r="2.5" fill="#ff6576"/>
      </g>)}
      {/* Paint opaque PA faces after every beam, mist and laser layer. */}
      <g className="speaker-stacks"><ConcertPA prefix={prefix}/><ConcertPA prefix={prefix} right/>
        <GroundSubs prefix={prefix} x={475}/><GroundSubs prefix={prefix} x={1053}/>
      </g>
      </g>
      <g className="stage-pixel-ribbon" fill="#ff263e">{Array.from({length:36},(_,i)=><rect key={i} x={40+i*32} y="587" width="20" height="3" rx="1" style={{animationDelay:`${i*-.12}s`}}/>)}</g>
      <g className="stage-performance" transform={`translate(${stageOffset} 0)`}>
      <g transform={composition === "welcome" ? "translate(825 500) scale(1.25) translate(-825 -500)" : undefined}>
      {/* A relaxed forward lean; both arms meet the controls on the console. */}
      <g className="stage-dj" transform="translate(825 415)">
        <path d="M-45 16L-43-17Q-40-29-17-34H17Q39-29 43-17L46 16Z" fill="#151b27" stroke="#485363" strokeWidth="1.5"/>
        <path d="M-30-22L-25 15M30-22L25 15" fill="none" stroke="#293241" strokeWidth="2"/>
        <path d="M-11-47V-31Q0-23 11-31V-47" fill="#886458"/>
        <path d="M-17-33Q0-16 17-33" fill="none" stroke="#080d16" strokeWidth="5"/>
        <g className="performer-head">
          <path d="M-22-80Q-22-101 0-103Q22-101 22-80L19-58Q13-43 0-42Q-13-43-19-58Z" fill="#9a7564"/>
          <path d="M-21-78L-17-57Q-10-44 0-43V-88Z" fill="#76584f"/>
          <path d="M-24-80Q-26-106 0-108Q25-106 24-80Q0-87-24-80Z" fill="#121925" stroke="#4b5869" strokeWidth="1.5"/>
          <path d="M-25-81Q0-88 25-81L28-76Q0-77-28-76Z" fill="#252e3e"/>
          <path d="M-12-91H12" stroke="#ff4357" strokeWidth="2"/>
          <path d="M-27-67V-83Q-27-110 0-111Q27-110 27-83V-67" fill="none" stroke="#111620" strokeWidth="7"/>
          <path d="M-27-80Q-29-110 0-111Q29-110 27-80" fill="none" stroke="#9caeba" strokeWidth="2"/>
          {[-29,21].map(x=><g key={x}><rect x={x} y="-78" width="9" height="22" rx="4" fill="#111620" stroke={x<0?'#73b9c6':'#d36c79'} strokeWidth="1.5"/><path d={`M${x+4} -72v10`} stroke="#56616f" strokeWidth="2"/></g>)}
          <path d="M-11-68L-5-67M5-67L11-68M1-66L-1-58H3" fill="none" stroke="#5f4742" strokeWidth="1.5" strokeLinecap="round"/>
          <path d="M-12-54Q0-43 12-54L8-48Q0-42-8-48Z" fill="#423b3b"/>
        </g>
        <path d="M-24-56Q-38-23-15-12" fill="none" stroke="#080c13" strokeWidth="2"/>
        <path d="M-8-9H8" stroke="#c2cbd3" strokeWidth="2"/>
      </g>
      <DJConsole prefix={prefix} />
      <g className="performer-arms" transform="translate(825 415)" strokeLinejoin="round">
        <g className="performer-arm performer-arm-left">
        <path d="M-37-20Q-45-19-49-4L-64 15L-91 23" fill="none" stroke="#18202d" strokeWidth="17" strokeLinecap="round"/>
        <path d="M-42-22L-64 10L-89 19" fill="none" stroke="#aeb2bf" strokeWidth="1.5" opacity=".65"/>
        <path d="M-91 19L-100 22L-109 28Q-111 31-107 32L-98 28L-104 33Q-104 36-100 34L-91 29L-85 28Z" fill="#a17a67" stroke="#c39780" strokeWidth="1"/>
        <path d="M-92 18L-88 28" stroke="#10151e" strokeWidth="4"/>
        </g>
        <g className="performer-arm performer-arm-right">
        <path d="M36-20Q45-17 48-3L52 11L23 22" fill="none" stroke="#202735" strokeWidth="17" strokeLinecap="round"/>
        <path d="M43-20L57 11L29 23" fill="none" stroke="#d16b79" strokeWidth="1.5" opacity=".7"/>
        <path d="M24 20L15 26L7 33Q5 36 9 37L17 32L12 38Q12 41 16 39L24 33L30 28Z" fill="#a17a67" stroke="#c39780" strokeWidth="1"/>
        <path d="M27 16L31 25" stroke="#10151e" strokeWidth="4"/>
        </g>
      </g>
      <g className="console-detail" fill="none">
        <path d="M678 459Q682 478 697 479M975 458Q967 480 954 479" stroke="#080a10" strokeWidth="3"/>
        <path d="M665 477L674 548M987 477L978 548" stroke="#77717e" strokeWidth="1"/>
        <path d="M666 483H670M665 488H669M981 483H985M980 488H984" stroke="#c3bac8" strokeWidth="2"/>
      </g>
      </g>
      </g>
      <g className="concert-crowd" fill="#070911">{Array.from({length:27},(_,i)=>{const x=i*48-16,y=622+(i%4)*7;return <g key={i} className={i%4===0?'crowd-dancer':''} style={{animationDelay:`${i*-.35}s`}}><ellipse cx={x} cy={y} rx={13+(i%3)} ry="17"/><path d={`M${x-22} 675V${y+27}Q${x} ${y+9} ${x+24} ${y+27}V675Z`}/>{i%5===0&&<path d={`M${x+14} ${y+34}L${x+30} ${y+4}L${x+33} ${y-35}`} fill="none" stroke="#070911" strokeWidth="9" strokeLinecap="round"/>}</g>;})}</g>
    </svg>
  </div>;
});
