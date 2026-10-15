import { memo, useId } from "react";
/** All lamps, beam pivots and laser emitters share one stage coordinate system. */
export const ConcertScenery = memo(function ConcertScenery() {
  const prefix = useId().replace(/:/g, "");
  const lamps=[100,300,500,700,900,1100];
  return <div className="concert-scenery" aria-hidden="true">
    <svg className="concert-venue" viewBox="0 0 1200 675" preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id={`${prefix}-venue-glow`}><stop stopColor="#8c264b"/><stop offset=".55" stopColor="#2b1330"/><stop offset="1" stopColor="#090b16"/></radialGradient>
        <linearGradient id={`${prefix}-warm-beam`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#ffe0be" stopOpacity=".55"/><stop offset=".45" stopColor="#ffad9e" stopOpacity=".17"/><stop offset="1" stopColor="#ed6f9e" stopOpacity="0"/></linearGradient>
        <linearGradient id={`${prefix}-cool-beam`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#a0ccff" stopOpacity=".5"/><stop offset=".5" stopColor="#7262ff" stopOpacity=".15"/><stop offset="1" stopColor="#658aff" stopOpacity="0"/></linearGradient>
        <linearGradient id={`${prefix}-booth-front`} x1="0" x2="0" y1="0" y2="1"><stop stopColor="#292237"/><stop offset="1" stopColor="#0e101d"/></linearGradient>
        <linearGradient id={`${prefix}-laser-fade`}><stop stopColor="#82fff4" stopOpacity=".85"/><stop offset="1" stopColor="#83b6ff" stopOpacity=".1"/></linearGradient>
        <linearGradient id={`${prefix}-stage-floor`} x1="0" x2="0" y1="0" y2="1"><stop stopColor="#8d315b" stopOpacity=".22"/><stop offset="1" stopColor="#070912"/></linearGradient>
        <pattern id={`${prefix}-led-grid`} width="10" height="10" patternUnits="userSpaceOnUse"><circle cx="5" cy="5" r="1" fill="#f2a5c3" opacity=".12"/></pattern>
      </defs>
      <rect width="1200" height="675" fill={`url(#${prefix}-venue-glow)`}/>
      <path d="M550 115H1080V495H550Z" fill="#1c142b" stroke="#55304d"/>
      <rect x="550" y="115" width="530" height="380" fill={`url(#${prefix}-led-grid)`}/>
      <g className="led-halo" transform="translate(815 300)" fill="none"><circle r="155" stroke="#ff263e" strokeWidth="2" opacity=".32"/><circle className="led-orbit" r="143" stroke="#ff4357" strokeWidth="8" strokeDasharray="24 28" opacity=".4"/><circle className="led-orbit-inner" r="126" stroke="#83bfff" strokeWidth="2" strokeDasharray="100 28" opacity=".35"/>{Array.from({length:36},(_,i)=><path key={i} d="M0-161V-174" transform={`rotate(${i*10})`} stroke={i%3?'#ff263e':'#a8d5ff'} strokeWidth="3" opacity=".25"/>)}</g>
      <image href="/afterparty-mark.svg" x="715" y="185" width="200" height="200" opacity=".8"/>
      <g className="stage-led-bars" fill="#ed577f">{Array.from({length:23},(_,i)=><rect key={i} x={585+i*20} y={425-(i%5)*11} width="8" height={25+(i%5)*11} rx="2" style={{animationDelay:`${i*-.14}s`}}/>)}</g>
      <g className="stage-light-bank">{lamps.map((x,i)=><g key={x} transform={`translate(${x} 82)`}><g className={`rig-beam ${i%2?'rig-beam-even':'rig-beam-odd'}`}><path d="M-6 0H6L190 570H-190Z" fill={i%2?`url(#${prefix}-cool-beam)`:`url(#${prefix}-warm-beam)`}/><path d="M-3 0H3L65 570H-65Z" fill={`url(#${prefix}-warm-beam)`} opacity=".4"/></g></g>)}</g>
      <g className="stage-truss" fill="none" stroke="#77717e" strokeWidth="2"><path d="M0 28H1200M0 57H1200"/>{Array.from({length:20},(_,i)=><path key={i} d={`M${i*60} 28l30 29 30-29`}/>)}</g>
      <g>{lamps.map((x,i)=><g key={x} transform={`translate(${x} 57)`}><path d="M-12 0V12H12V0M0 12V19" stroke="#aaa3ae" strokeWidth="3" fill="none"/><rect x="-17" y="16" width="34" height="14" rx="3" fill="#292331" stroke="#695463"/><rect x="-12" y="23" width="24" height="5" rx="2" fill={i%2?'#bbddff':'#ffe0bd'}/></g>)}</g>
      <path d="M0 500H1200V675H0Z" fill={`url(#${prefix}-stage-floor)`}/>
      <g stroke="#a0527a" strokeWidth="1" opacity=".18"><path d="M0 500H1200M0 540H1200M0 610H1200M600 500L0 675M720 500L400 675M840 500L800 675M960 500L1200 675"/></g>
      <ellipse className="stage-mist" cx="820" cy="490" rx="430" ry="100" fill="#b74c7c" opacity=".08"/>
      <g transform="translate(605 506)"><g className="laser-fan laser-fan-left" fill="none" stroke={`url(#${prefix}-laser-fade)`} strokeWidth="1.7">{[-420,-330,-240,-150,-60].map((y,i)=><path key={i} d={`M0 0L${350+i*100} ${y}`} />)}</g><rect x="-12" y="-7" width="24" height="14" rx="3" fill="#222033"/><circle r="3" fill="#92fff0"/></g>
      <g transform="translate(1065 506)"><g className="laser-fan laser-fan-right" fill="none" stroke="#f277c5" strokeWidth="1.5">{[-420,-330,-240,-150,-60].map((y,i)=><path key={i} d={`M0 0L${-350-i*100} ${y}`} />)}</g><rect x="-12" y="-7" width="24" height="14" rx="3" fill="#222033"/><circle r="3" fill="#ffb5e1"/></g>
      <g className="speaker-stacks" fill="#0c0e17" stroke="#49434e" strokeWidth="2">{[472,1105].map(x=><g key={x} transform={`translate(${x} 285)`}><path d="M0 0H60L75 18V230H0Z"/><path d="M60 0V215L75 230M0 215H60"/><rect x="8" y="14" width="44" height="35" rx="3" fill="#181923"/>{[90,155].map(y=><g key={y}><circle cx="30" cy={y} r="24"/><circle cx="30" cy={y} r="17" fill="#181923"/><circle cx="30" cy={y} r="6" fill="#292632"/></g>)}<path d="M8 204H50" stroke="#ff263e" strokeWidth="3"/></g>)}</g>
      <g className="stage-pixel-ribbon" fill="#ff263e">{Array.from({length:36},(_,i)=><rect key={i} x={40+i*32} y="587" width="20" height="3" rx="1" style={{animationDelay:`${i*-.12}s`}}/>)}</g>
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
      <g className="dj-booth"><path d="M645 460L684 426H970L1007 460Z" fill="#30293d" stroke="#987080"/><path d="M645 460H1007L986 564H665Z" fill={`url(#${prefix}-booth-front)`} stroke="#664159"/><path d="M661 469H991" stroke="#ff638d" strokeWidth="3"/><path d="M668 554H984" stroke="#663c79" strokeWidth="2"/>
        <g className="dj-decks">{[693,883].map((x,i)=><g key={x} transform={`translate(${x} 431)`}><path d="M-14-5H82L94 25H-26Z" fill="#10131c" stroke="#67616e"/><ellipse cx="32" cy="10" rx="27" ry="9" fill="#080b12" stroke="#c8c4cf" strokeWidth="1.5"/><ellipse className="deck-ring" cx="32" cy="10" rx="22" ry="7" fill="none" stroke={i?'#ff263e':'#8acfff'} strokeWidth="2" strokeDasharray="30 12"/><ellipse cx="32" cy="10" rx="7" ry="3" fill="#47414e"/><path d="M-1-2H20L23 3H-3Z" fill="#6ac8eb" opacity=".8"/>{[0,1,2,3].map(n=><path key={n} d={`M${n*12-6} 20h8l2 3h-8Z`} fill={n%2?'#ff263e':'#d6d3db'}/>)}<circle cx="73" cy="13" r="3" fill="#ff263e"/></g>)}</g>
        <g className="dj-mixer"><path d="M793 430H858L871 459H779Z" fill="#10131c" stroke="#77707e"/>{[797,810,823,836,849].map((x,i)=><g key={x}><circle cx={x} cy="435" r="2" fill="#c9c4ce"/><circle cx={x} cy="441" r="2" fill="#77717e"/><path d={`M${x} 446l-2 8`} stroke="#77717e"/><path d={`M${x-4} ${448+i%3*2}h6`} stroke="#e4dee8" strokeWidth="2"/></g>)}<path d="M803 456H845" stroke="#61596a"/><path d="M821 454V458" stroke="#ff263e" strokeWidth="3"/></g>
        <text x="826" y="527" textAnchor="middle" fill="#f2b7cd" fontFamily="Afterparty, Arial, sans-serif" fontSize="18" fontWeight="900" letterSpacing="-.5">afterparty<tspan fill="#ff263e">.</tspan></text>
      </g>
      <g className="performer-arms" transform="translate(825 415)" strokeLinejoin="round">
        <path d="M-37-20Q-45-19-49-4L-57 12L-80 19" fill="none" stroke="#18202d" strokeWidth="17" strokeLinecap="round"/>
        <path d="M-42-22L-57 7L-78 15" fill="none" stroke="#6da4b1" strokeWidth="1.5" opacity=".65"/>
        <path d="M-80 15L-88 18L-96 23Q-98 26-94 27L-86 24L-92 29Q-92 32-88 30L-80 25L-74 24Z" fill="#a17a67" stroke="#c39780" strokeWidth="1"/>
        <path d="M36-20Q45-17 48-3L52 11L23 22" fill="none" stroke="#202735" strokeWidth="17" strokeLinecap="round"/>
        <path d="M43-20L57 11L29 23" fill="none" stroke="#d16b79" strokeWidth="1.5" opacity=".7"/>
        <path d="M24 17L15 19L7 25Q5 28 9 29L17 25L11 31Q11 34 15 32L23 27L29 25Z" fill="#a17a67" stroke="#c39780" strokeWidth="1"/>
        <path d="M-81 14L-77 24M27 16L31 25" stroke="#10151e" strokeWidth="4"/>
      </g>
      <g className="console-detail" fill="none">
        <path d="M678 459Q682 478 697 479M975 458Q967 480 954 479" stroke="#080a10" strokeWidth="3"/>
        <path d="M665 477L674 548M987 477L978 548" stroke="#77717e" strokeWidth="1"/>
        <path d="M666 483H670M665 488H669M981 483H985M980 488H984" stroke="#c3bac8" strokeWidth="2"/>
        {[0,1,2,3,4,5].map(i=><path className="mixer-meter" key={i} d={`M873 ${432+i*3}h4`} stroke={i<2?'#ff4357':'#89ddbe'} strokeWidth="1.5" style={{animationDelay:`${i*-.21}s`}}/>)}
        <path d="M693 431l3-2 2 2 2-1 2 2 3-2 2 1M883 431l3-2 2 2 2-1 2 2 3-2 2 1" stroke="#e0f8ff" strokeWidth=".7"/>
      </g>
      <g fill="#10101c" stroke="#67445d"><path d="M485 555L510 523H583L603 555V580H485Z"/><path d="M1060 555L1085 523H1158L1178 555V580H1060Z"/><path d="M495 560H594M1070 560H1169" stroke="#34283b"/></g>
      <g className="concert-crowd" fill="#070911">{Array.from({length:27},(_,i)=>{const x=i*48-16,y=622+(i%4)*7;return <g key={i} className={i%4===0?'crowd-dancer':''} style={{animationDelay:`${i*-.35}s`}}><ellipse cx={x} cy={y} rx={13+(i%3)} ry="17"/><path d={`M${x-22} 675V${y+27}Q${x} ${y+9} ${x+24} ${y+27}V675Z`}/>{i%5===0&&<path d={`M${x+14} ${y+34}L${x+30} ${y+4}L${x+33} ${y-35}`} fill="none" stroke="#070911" strokeWidth="9" strokeLinecap="round"/>}</g>;})}</g>
    </svg>
  </div>;
});
