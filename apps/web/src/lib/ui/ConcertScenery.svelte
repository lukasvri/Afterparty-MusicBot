<script lang="ts">
  let {
    composition = 'welcome',
    animated = true,
  }: {
    composition?: 'welcome' | 'room';
    animated?: boolean;
  } = $props();
  const prefix = $props.id();
  const lights = [180, 390, 600, 810, 1020];
</script>

<!-- A decorative venue, never a playback surface or a second set of controls. -->
<div class="concert-scenery" class:animated data-composition={composition} aria-hidden="true">
  <svg viewBox="0 0 1200 675" fill="none" focusable="false">
    <defs>
      <radialGradient id={`${prefix}-ambience`} cx="50%" cy="45%" r="65%">
        <stop stop-color="#3d1723" stop-opacity=".66" />
        <stop offset=".58" stop-color="#17151c" stop-opacity=".7" />
        <stop offset="1" stop-color="#0c0d10" stop-opacity="0" />
      </radialGradient>
      <linearGradient id={`${prefix}-red-beam`} x1="0" y1="0" x2="0" y2="1">
        <stop stop-color="#ff465e" stop-opacity=".23" />
        <stop offset=".6" stop-color="#ff263e" stop-opacity=".055" />
        <stop offset="1" stop-color="#ff263e" stop-opacity="0" />
      </linearGradient>
      <linearGradient id={`${prefix}-white-beam`} x1="0" y1="0" x2="0" y2="1">
        <stop stop-color="#dfe5f1" stop-opacity=".12" />
        <stop offset="1" stop-color="#dfe5f1" stop-opacity="0" />
      </linearGradient>
      <linearGradient id={`${prefix}-booth`} x1="0" y1="0" x2="0" y2="1">
        <stop stop-color="#292c35" />
        <stop offset="1" stop-color="#101216" />
      </linearGradient>
      <linearGradient id={`${prefix}-floor`} x1="0" y1="0" x2="0" y2="1">
        <stop stop-color="#722636" stop-opacity=".18" />
        <stop offset="1" stop-color="#0c0d10" stop-opacity="0" />
      </linearGradient>
      <pattern id={`${prefix}-led`} width="10" height="10" patternUnits="userSpaceOnUse">
        <circle cx="5" cy="5" r=".8" fill="#e1dce8" opacity=".1" />
      </pattern>
      <pattern id={`${prefix}-grille`} width="4" height="4" patternUnits="userSpaceOnUse">
        <path d="M0 1H4M0 3H4" stroke="#444852" stroke-width=".55" />
      </pattern>
      <clipPath id={`${prefix}-screen`}>
        <rect x="316" y="137" width="568" height="352" rx="12" />
      </clipPath>
    </defs>

    {#snippet speaker(x: number, right: boolean)}
      <g class="pa-array" transform={`translate(${x} 0)`}>
        <g transform={right ? 'translate(86 0) scale(-1 1)' : undefined}>
          <path d="M14 56V156M63 56V156" stroke="#747983" stroke-width="2" />
          <path d="M-7 154H91V166H-7Z" fill="#30343d" stroke="#7f8591" />
          <circle cx="14" cy="156" r="3" fill="#0c0d10" stroke="#b7bdc9" />
          <circle cx="63" cy="156" r="3" fill="#0c0d10" stroke="#b7bdc9" />
          <path d="M78 172L91 164V385L78 393Z" fill="#22262e" stroke="#535a68" />
          <path d="M0 172L13 164H91L78 172Z" fill="#363b46" stroke="#727987" />
          <path d="M0 172H78V393H0Z" fill="#0c0e12" stroke="#6f7683" />
          {#each Array.from({ length: 7 }) as _, index}
            <g transform={`translate(0 ${175 + index * 31})`}>
              <rect x="3" width="72" height="27" rx="2" fill="#181c23" />
              <rect
                x="7"
                y="4"
                width="64"
                height="18"
                rx="1"
                fill={`url(#${prefix}-grille)`}
                stroke="#424955"
                stroke-width=".7"
              />
              <path d="M23 13H55" stroke="#69707e" stroke-width=".8" />
              {#if index < 6}<path d="M2 26V31M75 26V31" stroke="#949ba7" stroke-width="1.3" />{/if}
            </g>
          {/each}
        </g>
      </g>
    {/snippet}

    {#snippet subwoofer(x: number)}
      <g transform={`translate(${x} 535)`}>
        <path d="M0 10L12 0H140V61L128 73H0Z" fill="#101318" stroke="#68707e" />
        <path d="M0 10H128L140 0H12ZM128 10V73L140 61V0Z" fill="#292e37" stroke="#59616f" />
        {#each [8, 68] as left}
          <rect x={left} y="19" width="52" height="43" rx="3" fill="#191e26" stroke="#444c5a" />
          <circle cx={left + 26} cy="40" r="17" fill="#11151c" stroke="#383f4c" />
          <circle cx={left + 26} cy="40" r="7" fill="#1c222c" />
          <rect x={left + 2} y="21" width="48" height="39" rx="2" fill={`url(#${prefix}-grille)`} />
        {/each}
        <path d="M8 73V78M119 73V78" stroke="#090b0e" stroke-width="5" />
      </g>
    {/snippet}

    {#snippet deck(x: number)}
      <g class="dj-deck" transform={`translate(${x} 0)`}>
        <rect width="108" height="76" rx="5" fill="#171b22" stroke="#8c94a2" />
        <path d="M3 75H105V80H3Z" fill="#0a0d12" stroke="#434b59" />
        <rect x="8" y="6" width="66" height="14" rx="2" fill="#090e14" stroke="#525b6b" />
        <path
          d="M12 13h6l3-4 3 8 3-6h7l3 5 3-8 3 5h6l3-4 3 8 3-5h7"
          stroke="#c0d0df"
          stroke-width="1"
        />
        <path d="M42 7V19" stroke="#ff5e76" stroke-width="1.5" />
        <circle cx="47" cy="44" r="23" fill="#080c12" stroke="#b1bac8" stroke-width="1.3" />
        <circle cx="47" cy="44" r="19" fill="#29323f" stroke="#6c7788" />
        <circle
          class="deck-ring"
          cx="47"
          cy="44"
          r="21"
          stroke="#ff526d"
          stroke-width="2"
          stroke-dasharray="15 117"
        />
        <circle cx="47" cy="44" r="8" fill="#111720" stroke="#717d8d" />
        <path d="M47 38V42" stroke="#e8eef4" stroke-width="1.5" />
        <circle cx="12" cy="37" r="4" fill="#323a48" stroke="#a6afbc" />
        <circle cx="12" cy="55" r="5" fill="#ff3855" stroke="#ffb0bc" />
        <path d="M11 52L14 55L11 58Z" fill="#11151c" />
        <path d="M90 27V63M86 27H95M86 63H95" stroke="#8e98a8" />
        <rect x="86" y="42" width="9" height="5" rx="1" fill="#e0e6ec" stroke="#0b1018" />
        {#each [0, 1, 2, 3] as pad}
          <rect
            x={23 + pad * 14}
            y="69"
            width="10"
            height="4"
            rx="1"
            fill={pad === 0 ? '#ff526d' : '#99a4b6'}
          />
        {/each}
      </g>
    {/snippet}

    <rect width="1200" height="675" fill={`url(#${prefix}-ambience)`} />
    <path d="M106 104H1094V581H106Z" stroke="#292d37" opacity=".5" />
    <path d="M110 110H1090M110 579H1090" stroke="#3b303c" />

    <!-- Rear screen and haze remain behind every solid piece of stage hardware. -->
    <rect
      x="310"
      y="131"
      width="580"
      height="364"
      rx="18"
      fill="#0e1117"
      stroke="#535563"
      stroke-width="1.5"
    />
    <g clip-path={`url(#${prefix}-screen)`}>
      <rect x="316" y="137" width="568" height="352" fill={`url(#${prefix}-led)`} />
      <circle cx="600" cy="291" r="122" stroke="#a23950" stroke-width="1.4" opacity=".7" />
      <circle cx="600" cy="291" r="136" stroke="#5e2d3b" opacity=".55" />
      <path d="M471 290H729M600 162V420" stroke="#8d354a" stroke-width=".7" opacity=".22" />
      <image href="/afterparty-mark.svg" x="475" y="165" width="250" height="250" opacity=".94" />
    </g>

    <g class="light-bank">
      {#each lights as x, index}
        <g transform={`translate(${x} 83)`}>
          <path
            class="light-beam"
            style={`--delay:${index * -1.7}s`}
            d="M-5 0H5L125 490H-125Z"
            fill={`url(#${prefix}-${index % 2 ? 'white' : 'red'}-beam)`}
          />
        </g>
      {/each}
    </g>
    <path d="M60 31H1140M60 59H1140" stroke="#6e7480" stroke-width="2" />
    {#each Array.from({ length: 18 }) as _, index}
      <path
        d={`M${60 + index * 60} 31L${90 + index * 60} 59L${120 + index * 60} 31`}
        stroke="#535967"
        stroke-width="1.4"
      />
    {/each}
    {#each lights as x, index}
      <g transform={`translate(${x} 59)`}>
        <path d="M-13 0V12H13V0M0 12V20" stroke="#a0a8b7" stroke-width="2.5" />
        <rect x="-19" y="18" width="38" height="17" rx="5" fill="#252b35" stroke="#747d8c" />
        <rect
          x="-11"
          y="29"
          width="22"
          height="4"
          rx="2"
          fill={index % 2 ? '#d9e6ee' : '#ff6279'}
        />
      </g>
    {/each}

    <path d="M90 501H1110L1200 675H0Z" fill={`url(#${prefix}-floor)`} />
    <path
      d="M90 501H1110M42 574H1158M505 501L335 675M695 501L865 675M600 501V675"
      stroke="#74505e"
      opacity=".18"
    />
    <ellipse cx="600" cy="577" rx="340" ry="30" fill="#06090d" opacity=".6" />
    {@render speaker(158, false)}
    {@render speaker(956, true)}
    {@render subwoofer(155)}
    {@render subwoofer(905)}

    <g
      class="performance"
      transform={composition === 'welcome'
        ? 'translate(600 530) scale(1.12) translate(-600 -530)'
        : undefined}
    >
      <!-- The performer is behind the counter; his arms and hands are painted last. -->
      <g transform="translate(600 425)">
        <path
          d="M-48 18L-44-17Q-40-30-17-35H17Q40-30 44-17L48 18Z"
          fill="#202937"
          stroke="#5b6577"
          stroke-width="1.5"
        />
        <path d="M-30-21L-25 16M30-21L25 16" stroke="#394454" stroke-width="2" />
        <path d="M-11-48V-32Q0-22 11-32V-48" fill="#a57a65" />
        <path d="M-17-34Q0-17 17-34" stroke="#111721" stroke-width="5" />
        <g class="performer-head">
          <path
            d="M-23-81Q-23-102 0-104Q23-102 23-81L20-59Q13-44 0-43Q-13-44-20-59Z"
            fill="#c69a80"
          />
          <path d="M-22-80L-18-59Q-11-46 0-44V-91Z" fill="#9a725f" />
          <path
            d="M-25-82Q-27-108 0-110Q27-108 25-82Q0-90-25-82Z"
            fill="#17202d"
            stroke="#68768c"
            stroke-width="1.5"
          />
          <path
            d="M-26-83Q0-91 26-83L30-77Q0-78-30-77Z"
            fill="#303c50"
            stroke="#8490a3"
            stroke-width=".6"
          />
          <path d="M-11-93H11" stroke="#ff526c" stroke-width="2" />
          <path d="M-29-67V-83Q-29-113 0-114Q29-113 29-83V-67" stroke="#101722" stroke-width="8" />
          <path d="M-29-83Q-29-113 0-114Q29-113 29-83" stroke="#b9c6d4" stroke-width="2" />
          <rect
            x="-33"
            y="-79"
            width="10"
            height="24"
            rx="4"
            fill="#1c2634"
            stroke="#b3d0dc"
            stroke-width="1.5"
          />
          <rect
            x="23"
            y="-79"
            width="10"
            height="24"
            rx="4"
            fill="#1c2634"
            stroke="#ff8c9c"
            stroke-width="1.5"
          />
          <path
            d="M-12-68L-5-67M5-67L12-68M1-66L-1-58H3"
            stroke="#6a4b43"
            stroke-width="1.5"
            stroke-linecap="round"
          />
          <path d="M-12-54Q0-43 12-54L8-48Q0-42-8-48Z" fill="#60463f" />
        </g>
        <path d="M-24-55Q-38-25-16-12" stroke="#0b1018" stroke-width="2" />
        <path d="M-8-8H8" stroke="#aebacc" stroke-width="2" />
      </g>

      <path d="M350 475L374 423H826L850 475Z" fill="#343a46" stroke="#8892a2" stroke-width="1.4" />
      <path
        d="M350 475H850L825 582H375Z"
        fill={`url(#${prefix}-booth)`}
        stroke="#555e6e"
        stroke-width="1.3"
      />
      <path d="M364 486H836" stroke="#ff3c59" stroke-width="3" />
      <path d="M380 568H820M388 497L398 560M812 497L802 560" stroke="#525968" opacity=".65" />
      <g class="control-plane" transform="translate(0 431) scale(1 .55)">
        {@render deck(414)}
        {@render deck(677)}
        <g class="dj-mixer">
          <rect x="566" width="76" height="80" rx="4" fill="#111720" stroke="#a2adbd" />
          {#each [579, 593, 607, 621] as x, channel}
            <path d={`M${x - 5} 5V66`} stroke="#3b4555" stroke-width=".8" />
            {#each [10, 22, 34, 45] as y, knob}
              <circle cx={x} cy={y} r="3" fill="#333f50" stroke="#b1bccb" stroke-width=".7" />
              <path
                d={`M${x} ${y - 2}v1.5`}
                stroke={knob === 0 ? '#ff627a' : '#e7edf4'}
                stroke-width=".8"
              />
            {/each}
            <path d={`M${x} 53V66`} stroke="#8f9aab" />
            <rect
              x={x - 4}
              y={55 + (channel % 3) * 3}
              width="8"
              height="4"
              rx="1"
              fill="#d2dce8"
              stroke="#101722"
            />
          {/each}
          {#each Array.from({ length: 8 }) as _, index}
            <rect
              class="mixer-meter"
              x="633"
              y={12 + index * 6}
              width="4"
              height="3"
              rx=".5"
              fill={index < 2 ? '#ff3855' : '#d7e8df'}
              style={`--delay:${index * -0.19}s`}
            />
          {/each}
          <path d="M584 74H625" stroke="#939eae" stroke-width="1.4" />
          <rect x="601" y="71" width="6" height="7" rx="1" fill="#e6edf4" stroke="#0c1119" />
        </g>
      </g>
      <text
        x="600"
        y="544"
        text-anchor="middle"
        fill="#eeedf0"
        font-family="Inter, Arial, sans-serif"
        font-size="27"
        font-weight="750"
        letter-spacing="-1.3">afterparty<tspan fill="#ff3855">.</tspan></text
      >

      <g transform="translate(600 425)" stroke-linecap="round" stroke-linejoin="round">
        <path d="M-38-20Q-47-19-52-3L-67 16L-91 24" stroke="#253041" stroke-width="18" />
        <path d="M-43-22L-67 11L-89 20" stroke="#b7c3d4" stroke-width="1.5" opacity=".65" />
        <path
          d="M-92 19L-101 23L-110 29Q-112 32-108 33L-99 29L-105 34Q-105 37-101 35L-92 30L-85 29Z"
          fill="#c69a80"
          stroke="#e8b697"
          stroke-width="1"
        />
        <path d="M-93 19L-89 29" stroke="#0d1420" stroke-width="4" />
        <path d="M37-20Q46-17 50-2L55 12L25 24" stroke="#2b3546" stroke-width="18" />
        <path d="M44-21L60 12L30 25" stroke="#e48799" stroke-width="1.5" opacity=".7" />
        <path
          d="M26 21L16 27L8 34Q6 37 10 38L18 33L13 39Q13 42 17 40L25 34L32 29Z"
          fill="#c69a80"
          stroke="#e8b697"
          stroke-width="1"
        />
        <path d="M28 18L32 27" stroke="#0d1420" stroke-width="4" />
      </g>
      <path
        d="M375 486Q379 502 394 506M825 486Q821 502 806 506"
        stroke="#080d15"
        stroke-width="3"
      />
    </g>

    <path d="M93 615H1107" stroke="#79404d" opacity=".35" />
    {#each Array.from({ length: 17 }) as _, index}
      <g fill="#0a0d14" opacity={index % 3 ? '.94' : '.82'}>
        <ellipse cx={20 + index * 74} cy={635 + (index % 3) * 5} rx={15 + (index % 3)} ry="19" />
        <path
          d={`M${index * 74 - 6} 675V${663 + (index % 3) * 3}Q${20 + index * 74} ${640 + (index % 3) * 5} ${46 + index * 74} ${663 + (index % 3) * 3}V675Z`}
        />
        {#if index % 5 === 1}<path
            d={`M${34 + index * 74} 667L${50 + index * 74} 637L${54 + index * 74} 608`}
            stroke="#0a0d14"
            stroke-width="10"
            stroke-linecap="round"
          />{/if}
      </g>
    {/each}
  </svg>
</div>

<style>
  .concert-scenery {
    width: 100%;
    aspect-ratio: 16 / 9;
    pointer-events: none;
    user-select: none;
    overflow: hidden;
    contain: layout paint;
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
  }
  .animated .light-beam {
    animation: light-breathe 8s ease-in-out infinite alternate;
    animation-delay: var(--delay, 0s);
  }
  .animated .performer-head {
    transform-box: fill-box;
    transform-origin: center bottom;
    animation: head-nod 4.6s ease-in-out infinite;
  }
  .animated .deck-ring {
    transform-box: fill-box;
    transform-origin: center;
    animation: platter-turn 24s linear infinite;
  }
  .animated .mixer-meter {
    animation: meter-breathe 1.9s ease-in-out infinite alternate;
    animation-delay: var(--delay, 0s);
  }
  @keyframes light-breathe {
    from {
      opacity: 0.42;
    }
    to {
      opacity: 1;
    }
  }
  @keyframes head-nod {
    0%,
    100% {
      transform: rotate(-1deg);
    }
    50% {
      transform: rotate(1deg) translateY(1px);
    }
  }
  @keyframes platter-turn {
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes meter-breathe {
    from {
      opacity: 0.3;
    }
    to {
      opacity: 0.95;
    }
  }
  :global(html[data-motion='off']) .concert-scenery *,
  :global(html[data-motion='off']) .concert-scenery {
    animation: none !important;
  }
  @media (prefers-reduced-motion: reduce) {
    .concert-scenery *,
    .concert-scenery {
      animation: none !important;
    }
  }
</style>
