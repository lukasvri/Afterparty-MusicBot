<style>
  :global {
    @font-face {
      font-family: Inter;
      src: url('/fonts/inter-latin-wght-normal.woff2') format('woff2');
      font-weight: 100 900;
      font-display: swap;
    }
    :root {
      font-family: Inter, Arial, sans-serif;
      color: #f4f3ef;
      background: #0c0d10;
      font-synthesis: none;
      text-rendering: optimizeLegibility;
      -webkit-font-smoothing: antialiased;
      font-size: 16px;
      --app-background: #0c0d10;
      --app-width: 3200px;
      --app-space: clamp(20px, 2.5vw, 64px);
      --page-title: clamp(30px, 2.6vw, 52px);
      --control-height: 48px;
      --control-radius: 12px;
      --control-font: clamp(14px, 0.55vw, 18px);
      --panel-radius: 20px;
      --panel-space: clamp(20px, 1.5vw, 32px);
      --panel-title: clamp(22px, 1.2vw, 30px);
      --body-size: clamp(14px, 0.65vw, 18px);
      --red: #ff263e;
      --muted: #b0b1bd;
      --line: #2b2e37;
      --surface: #14161a;
      --surface-raised: #1b1e24;
      --surface-hover: #242832;
      --text: #f4f3ef;
      --radius: 16px;
      --radius-lg: 24px;
      --page-space: clamp(20px, 2.3vw, 64px);
      --ease: cubic-bezier(0.23, 1, 0.32, 1);
      color-scheme: dark;
    }
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      -webkit-text-size-adjust: 100%;
    }
    a {
      color: inherit;
      text-decoration: none;
    }
    button,
    input,
    select,
    textarea {
      font: inherit;
    }
    button,
    a,
    input {
      -webkit-tap-highlight-color: transparent;
    }
    button {
      cursor: pointer;
    }
    :where(button, a, summary) {
      touch-action: manipulation;
    }
    :where(button, summary) {
      -webkit-user-select: none;
      user-select: none;
    }
    @media (pointer: coarse) {
      :where(input, select, textarea) {
        font-size: max(16px, 1em) !important;
      }
    }
    :where(
      input:not([type='range']):not([type='checkbox']):not([type='radio']):not([type='file']):not(
          [type='hidden']
        ),
      select,
      textarea
    ) {
      min-height: var(--control-height);
      padding: 10px 12px;
      border: 1px solid #414550;
      border-radius: var(--control-radius);
      background: #101115;
      color: var(--text);
      line-height: 1.5;
      max-width: 100%;
    }
    :where(input, textarea)::placeholder {
      color: #8e909e;
      opacity: 1;
    }
    :where(summary) {
      cursor: pointer;
    }
    button:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }
    button:focus-visible,
    a:focus-visible,
    input:focus-visible,
    select:focus-visible,
    textarea:focus-visible,
    summary:focus-visible {
      outline: 2px solid var(--red);
      outline-offset: 4px;
    }
    button,
    input {
      border-radius: 10px;
    }
    h1,
    h2,
    h3,
    p {
      margin: 0;
    }
    button svg,
    a svg {
      flex-shrink: 0;
    }
    .red {
      color: var(--red);
    }
    .app-shell {
      display: block;
      min-height: 100dvh;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 9px;
      font-size: 21px;
      font-weight: 750;
      letter-spacing: -1px;
    }
    .brand img {
      width: 36px;
      height: 36px;
    }
    .nav-link {
      display: flex;
      align-items: center;
      gap: 12px;
      min-height: 50px;
      padding: 12px 14px;
      font-size: 14px;
      font-weight: 550;
      color: #bfc0cb;
      margin-bottom: 7px;
      border-radius: 12px;
      transition:
        color 160ms var(--ease),
        background 160ms var(--ease);
    }
    @media (hover: hover) and (pointer: fine) {
      .nav-link:hover {
        background: var(--surface-raised);
        color: #fff;
      }
    }
    .nav-link svg:last-child:not(:first-child) {
      margin-left: auto;
    }
    .workspace {
      min-width: 0;
    }
    .eyebrow {
      font-size: 11px;
      letter-spacing: 1.6px;
      font-weight: 700;
      line-height: 1.6;
    }
    .top-status {
      display: flex;
      align-items: center;
      gap: 9px;
      font-size: 13px;
      color: #c3c4ce;
    }
    .status-dot {
      width: 6px;
      height: 6px;
      display: inline-block;
      background: #888;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .status-dot.online {
      background: var(--red);
      box-shadow: 0 0 0 4px #ff263e14;
    }
    .app-page {
      min-height: 100svh;
      display: flex;
      flex-direction: column;
      background: var(--app-background);
    }
    main.app-main {
      flex: 1;
      width: 100%;
      max-width: var(--app-width);
      margin-inline: auto;
      padding: 36px var(--app-space) 56px;
      padding-left: max(var(--app-space), env(safe-area-inset-left));
      padding-right: max(var(--app-space), env(safe-area-inset-right));
    }
    .app-page.tv-mode main.app-main {
      max-width: none;
    }
    @media (min-width: 2400px) {
      :root {
        --control-height: 56px;
      }
    }
    body .theater-mode .audio-stage:not(.fullscreen),
    body .theater-mode .concert-art {
      position: fixed;
      inset: 0;
      z-index: 100;
      width: 100%;
      height: 100dvh;
      max-height: none;
      aspect-ratio: auto;
      margin: 0;
      border: 0;
      border-radius: 0;
      background: black;
    }
    .theater-mode .concert-art img {
      object-fit: contain;
    }
    .context-bar {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: var(--panel-radius);
      padding: 20px;
      margin-bottom: 24px;
    }
    main {
      width: 100%;
      max-width: 1800px;
      margin: auto;
      padding: clamp(28px, 3vw, 64px) var(--page-space);
    }
    .welcome {
      padding-top: clamp(16px, 2.5vw, 52px);
      max-width: 1280px;
    }
    .welcome h1 {
      font-size: clamp(52px, 6.4vw, 104px);
      line-height: 1.01;
      letter-spacing: -0.065em;
      font-weight: 750;
      margin: 24px 0;
    }
    .intro {
      font-size: clamp(16px, 1.1vw, 20px);
      color: var(--muted);
      line-height: 1.7;
      max-width: 540px;
    }
    .room-forms {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 20px;
      margin-top: 40px;
      max-width: 1100px;
    }
    .room-forms > form {
      padding: clamp(22px, 2vw, 34px);
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      min-width: 0;
    }
    .room-forms > form:first-child {
      border-top: 2px solid var(--red);
    }
    .room-forms h2 {
      font-size: 24px;
      letter-spacing: -0.035em;
      line-height: 1.25;
    }
    .room-forms p {
      color: var(--muted);
      font-size: 14px;
      line-height: 1.7;
      margin-top: 9px;
    }
    .room-forms label {
      display: block;
      color: #d4d5de;
      font-size: 13px;
      font-weight: 550;
      margin: 24px 0 10px;
    }
    .room-forms input {
      width: 100%;
      height: 50px;
      background: #101115;
      border: 1px solid #414550;
      padding: 0 16px;
      font-size: 16px;
    }
    .room-forms .button {
      margin-top: 14px;
      width: 100%;
      justify-content: space-between;
    }
    .button {
      min-height: var(--control-height);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      border: 1px solid transparent;
      border-radius: var(--control-radius);
      padding: 12px 18px;
      font-size: var(--control-font);
      font-weight: 650;
      line-height: 1.4;
      transition:
        transform 120ms var(--ease),
        background 160ms var(--ease),
        border-color 160ms var(--ease),
        color 160ms var(--ease);
    }
    .primary {
      background: var(--red);
      color: #0c0b0d;
    }
    @media (hover: hover) and (pointer: fine) {
      .primary:hover:enabled,
      a.primary:hover {
        background: #ff6172;
      }
    }
    .secondary {
      background: var(--surface-raised);
      color: #eeedf0;
      border-color: #3a3e49;
    }
    @media (hover: hover) and (pointer: fine) {
      .secondary:hover:enabled,
      a.secondary:hover {
        background: var(--surface-hover);
        border-color: #686572;
      }
    }
    .button:active:enabled,
    a.button:active {
      filter: brightness(0.88);
    }
    @media (prefers-reduced-motion: no-preference) {
      html:not([data-motion='off']) .button:active:enabled:not(:focus-visible),
      html:not([data-motion='off']) a.button:active:not(:focus-visible) {
        transform: scale(0.97);
      }
    }
    .welcome-foot {
      display: flex;
      gap: 30px;
      margin: 35px 0 20px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 1.3px;
      color: #a1a0a8;
    }
    .room-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
      margin-bottom: 32px;
    }
    .room-heading .eyebrow {
      color: var(--muted);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .room-heading .eyebrow > span {
      color: #4c4b52;
      margin: 0 5px;
    }
    .room-heading h1 {
      font-size: clamp(30px, 3.5vw, 48px);
      letter-spacing: -2px;
      line-height: 1.15;
      margin-top: 12px;
      overflow-wrap: anywhere;
    }
    .invite {
      flex-shrink: 0;
    }
    .room-code {
      font-family: monospace;
      letter-spacing: 1px;
      color: #b6b4bc;
      border-left: 1px solid #45454c;
      padding-left: 12px;
      font-size: 12px;
    }
    .listening-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.75fr) minmax(300px, 1fr);
      gap: clamp(24px, 2vw, 40px);
      align-items: start;
    }
    .section-heading {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 20px;
    }
    .section-heading h2 {
      font-size: 20px;
      letter-spacing: -0.035em;
    }
    .section-heading > .eyebrow {
      font-size: 10px;
      letter-spacing: 1.4px;
      color: var(--muted);
    }
    .count {
      font-size: 13px;
      background: #29292f;
      border-radius: 4px;
      padding: 3px 8px;
      color: #cdccd2;
    }
    .audio-stage {
      aspect-ratio: 16/9;
      position: relative;
      overflow: hidden;
      background: #151517;
      border: 1px solid var(--line);
      border-radius: var(--radius);
    }
    .audio-stage > div:first-child,
    .audio-stage iframe {
      width: 100%;
      height: 100%;
      position: absolute;
      inset: 0;
      border: 0;
    }
    .audio-prompt {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 14px;
    }
    .audio-prompt p {
      font-size: 12px;
      color: var(--muted);
    }
    .record {
      width: 116px;
      height: 116px;
      border-radius: 50%;
      background: repeating-radial-gradient(circle at center, #161619 0 3px, #242428 4px 5px);
      display: grid;
      place-items: center;
      box-shadow: 0 8px 26px #0006;
    }
    .record > span {
      display: grid;
      place-content: center;
      width: 48px;
      height: 48px;
      background: #0c0d10;
      border-radius: 50%;
      font-size: 25px;
      font-weight: 750;
      letter-spacing: -3px;
      position: relative;
    }
    .record .red {
      position: absolute;
      right: 5px;
      bottom: 6px;
    }
    .track-meta {
      padding: 24px 0 18px;
    }
    .track-meta > .eyebrow {
      font-size: 10px;
    }
    .track-meta h2 {
      font-size: 23px;
      line-height: 1.35;
      letter-spacing: -0.7px;
      margin-top: 7px;
      overflow-wrap: anywhere;
    }
    .track-meta p {
      font-size: 14px;
      color: var(--muted);
      margin-top: 7px;
    }
    .transport {
      display: flex;
      align-items: center;
      gap: 13px;
    }
    .icon-button {
      width: 44px;
      height: 44px;
      display: grid;
      place-content: center;
      border: 1px solid transparent;
      color: #d5d4da;
      background: transparent;
      flex-shrink: 0;
    }
    .icon-button:hover {
      background: #2a292f;
    }
    .timeline {
      flex: 1;
      min-width: 0;
    }
    .permission-note {
      font-size: 13px;
      color: var(--muted);
      margin-top: 17px;
      line-height: 1.6;
    }
    .empty-stage {
      min-height: 320px;
      border: 1px solid var(--line);
      background: #131315;
      border-radius: var(--radius);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 20px;
      text-align: center;
      padding: 28px;
    }
    .empty-stage h2 {
      font-size: 24px;
      line-height: 1.3;
      letter-spacing: -0.8px;
    }
    .empty-stage p {
      font-size: 13px;
      color: var(--muted);
      line-height: 1.8;
    }
    .queue-panel {
      display: flex;
      flex-direction: column;
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      background: var(--surface);
      padding: 24px;
      min-width: 0;
    }
    .queue-list,
    .search-results {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .queue-list {
      max-height: min(52vh, 600px);
      overflow: auto;
      scrollbar-width: thin;
      scrollbar-color: #525662 transparent;
      scrollbar-gutter: stable;
    }
    .queue-list li,
    .search-results li {
      display: flex;
      align-items: center;
      gap: 12px;
      min-height: 70px;
      border-top: 1px solid #232327;
      padding: 10px 0;
    }
    .track-number {
      color: #8b8993;
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      min-width: 18px;
    }
    .track-info {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
      flex: 1;
    }
    .track-info strong {
      font-weight: 600;
      font-size: 14px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      line-height: 1.6;
    }
    .track-info > span {
      font-size: 12px;
      color: var(--muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .duration {
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      color: #b3b0bc;
      flex-shrink: 0;
    }
    .empty-queue {
      flex: 1;
      min-height: 240px;
      display: flex;
      justify-content: center;
      align-items: center;
      flex-direction: column;
      text-align: center;
      gap: 16px;
      color: #797780;
    }
    .empty-queue h3 {
      font-size: 15px;
      color: #dbd9e0;
      font-weight: 500;
    }
    .empty-queue p {
      font-size: 13px;
      color: var(--muted);
      line-height: 1.8;
    }
    .queue-footer {
      display: flex;
      align-items: center;
      gap: 10px;
      border-top: 1px solid var(--line);
      padding-top: 18px;
      margin-top: auto;
      color: var(--muted);
      font-size: 12px;
    }
    .discovery {
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      background: var(--surface);
      margin-top: 32px;
      padding: clamp(22px, 2vw, 32px);
    }
    .discovery .section-heading h2 {
      font-size: 24px;
      margin-top: 8px;
      letter-spacing: -0.8px;
    }
    .search-form {
      display: flex;
      align-items: center;
      gap: 12px;
      background: #101115;
      border: 1px solid #464a55;
      border-radius: 14px;
      padding: 6px 6px 6px 16px;
    }
    .search-form > svg {
      color: #8c8993;
      flex-shrink: 0;
    }
    .search-form input {
      flex: 1;
      min-width: 0;
      background: transparent;
      border: 0;
      color: var(--text);
      height: 46px;
      font-size: 16px;
    }
    .search-form input:focus {
      outline-offset: 0;
    }
    .search-summary {
      font-size: 13px;
      color: var(--muted);
      margin: 16px 0;
      line-height: 1.7;
    }
    .search-results li {
      min-height: 68px;
      padding: 10px 12px;
    }
    .search-results li:hover {
      background: #17171b;
    }
    .add-track {
      background: #25252b;
    }
    .room-bottom {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      border-top: 1px solid var(--line);
      margin-top: 32px;
      padding-top: 25px;
      font-size: 11px;
      letter-spacing: 1px;
      color: var(--muted);
    }
    .room-bottom a {
      font-size: 13px;
      letter-spacing: 0;
      display: flex;
      gap: 8px;
      align-items: center;
      min-height: 44px;
    }
    .footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      padding: 26px 44px;
      border-top: 1px solid var(--line);
      color: #a1a0a8;
    }
    .footer > span:first-of-type {
      font-weight: 750;
      font-size: 18px;
      letter-spacing: -0.8px;
    }
    .footer > span:last-child {
      font-size: 10px;
      letter-spacing: 1.8px;
    }
    .error-message,
    .audio-message {
      border: 1px solid #a63a4b;
      background: #2a151c;
      border-radius: 10px;
      padding: 16px;
      font-size: 14px;
      line-height: 1.7;
      margin-top: 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
    }
    .error-message {
      position: sticky;
      bottom: 16px;
      z-index: 3;
    }
    .error-message .button {
      flex-shrink: 0;
    }
    .audio-message {
      margin-top: 12px;
      flex-wrap: wrap;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
    }
    .skip-link {
      position: fixed;
      top: -100px;
      left: 20px;
      background: var(--red);
      padding: 15px;
      z-index: 20;
      color: #000;
    }
    .skip-link:focus {
      top: 15px;
    }
    @media (min-width: 1600px) {
      main {
        padding-top: 55px;
      }
      .welcome {
        padding-top: 60px;
      }
    }
    @media (max-width: 1150px) {
      .brand {
        font-size: 19px;
      }
      main {
        padding: 30px;
      }
      .listening-grid {
        gap: 22px;
        grid-template-columns: minmax(0, 1.4fr) minmax(220px, 1fr);
      }
      .queue-panel {
        padding-left: 20px;
      }
      .room-heading {
        align-items: flex-start;
      }
      .invite {
        font-size: 0;
        gap: 10px;
      }
      .room-code {
        border: 0;
        padding: 0;
      }
      .audio-prompt .record {
        width: 85px;
        height: 85px;
      }
      .audio-prompt {
        gap: 10px;
      }
      .audio-prompt p {
        font-size: 11px;
      }
      .room-forms {
        gap: 25px;
      }
      .welcome h1 {
        letter-spacing: -0.06em;
      }
      .welcome-foot {
        gap: 20px;
        font-size: 10px;
      }
    }
    @media (max-width: 800px) {
      .app-shell {
        display: block;
      }
      .brand {
        font-size: 21px;
        max-width: 190px;
      }
      .nav-link {
        min-height: 44px;
        flex: 1;
        justify-content: center;
        margin: 0;
        padding: 10px 6px;
        font-size: 12px;
        gap: 7px;
      }
      .nav-link svg {
        width: 16px;
      }
      .nav-link svg:last-child:not(:first-child) {
        display: none;
      }
      .top-status {
        font-size: 12px;
      }
      main {
        padding: 28px 22px;
      }
      .welcome {
        padding-top: 14px;
      }
      .welcome h1 {
        font-size: clamp(55px, 11vw, 90px);
        letter-spacing: -0.06em;
      }
      .room-heading {
        display: block;
        margin-bottom: 27px;
      }
      .room-heading h1 {
        font-size: 36px;
        margin-bottom: 18px;
      }
      .invite {
        font-size: 13px;
      }
      .room-code {
        font-size: 11px;
        border-left: 1px solid #45454c;
        padding-left: 10px;
      }
      .listening-grid {
        grid-template-columns: 1fr;
        gap: 34px;
      }
      .queue-panel {
        border-left: 0;
        padding: 22px;
      }
      .queue-list {
        max-height: 300px;
      }
      .empty-queue {
        min-height: 175px;
      }
      .queue-footer {
        margin-top: 16px;
      }
      .track-meta h2 {
        font-size: 23px;
      }
      .empty-stage {
        min-height: 285px;
      }
      .audio-prompt .record {
        width: 100px;
        height: 100px;
      }
      .discovery {
        margin-top: 30px;
        padding-top: 27px;
      }
      .room-bottom {
        align-items: flex-start;
        flex-direction: column;
        gap: 8px;
      }
      .footer {
        padding: 25px 22px;
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 16px;
      }
      .footer > span:first-of-type {
        text-align: right;
        font-size: 18px;
      }
      .footer > a {
        grid-column: 1/-1;
        text-align: center;
        white-space: nowrap;
      }
      .footer > span:last-child {
        grid-column: 1/-1;
        text-align: center;
      }
      .room-forms {
        margin-top: 35px;
      }
      .welcome-foot {
        flex-wrap: wrap;
        gap: 14px;
      }
      .welcome .eyebrow {
        font-size: 10px;
      }
      .intro {
        font-size: 15px;
      }
    }
    @media (max-width: 500px) {
      .room-forms {
        grid-template-columns: 1fr;
        gap: 30px;
      }
      .room-forms form + form {
        border-top: 1px solid var(--line);
        padding-top: 28px;
      }
      .room-forms label {
        margin-top: 18px;
      }
      .welcome h1 {
        font-size: 57px;
        letter-spacing: -3.8px;
      }
      .search-form {
        gap: 8px;
        padding-left: 11px;
      }
      .search-form input {
        font-size: 13px;
      }
      .search-form .button {
        font-size: 12px;
        padding: 9px 11px;
        gap: 0;
      }
      .search-form > svg {
        width: 16px;
      }
      .audio-prompt .record {
        width: 74px;
        height: 74px;
      }
      .audio-prompt .button {
        min-height: 40px;
        font-size: 12px;
        padding: 8px 12px;
      }
      .audio-prompt p {
        font-size: 10px;
      }
      .audio-prompt {
        gap: 8px;
      }
      .room-heading .eyebrow {
        font-size: 10px;
        gap: 5px;
      }
      .track-meta h2 {
        font-size: 21px;
      }
      .error-message {
        flex-wrap: wrap;
        gap: 12px;
      }
      .search-results li {
        padding: 8px 2px;
        gap: 10px;
      }
      .footer > span:last-child {
        font-size: 10px;
      }
      .transport {
        gap: 8px;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      *,
      *::before,
      *::after {
        animation: none !important;
        transition: none !important;
        scroll-behavior: auto !important;
      }
    }

    .room-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    @media (max-width: 800px) {
      .room-actions {
        gap: 8px;
      }
    }

    button.nav-link {
      width: auto;
      text-align: left;
      border: 0;
      background: transparent;
      border-radius: 5px;
    }
    .room-settings {
      border-top: 1px solid var(--line);
      padding-top: 28px;
      display: grid;
      gap: 22px;
    }
    .room-settings > input {
      max-width: 400px;
      padding: 14px;
      border: 1px solid var(--line);
      background: #151517;
      color: inherit;
    }
    .checkbox-label,
    .room-forms .checkbox-label {
      display: flex;
      gap: 12px;
      align-items: center;
      font-size: 14px;
      line-height: 1.7;
    }
    .checkbox-label input,
    .room-forms .checkbox-label input {
      width: 20px;
      height: 20px;
      flex-shrink: 0;
      accent-color: var(--red);
    }
    @media (max-width: 800px) {
      button.nav-link {
        width: auto;
      }
      .nav-link {
        flex-shrink: 0;
        white-space: nowrap;
      }
    }

    /* Shared fluid TV sizing for listening rooms and public concerts. */
    .tv-mode {
      --tv-space: clamp(24px, 1.25vw, 48px);
      --tv-gap: clamp(20px, 1.042vw, 40px);
      --tv-sidebar: clamp(270px, 14.063vw, 540px);
      --tv-title: clamp(30px, 1.563vw, 60px);
      --tv-track: clamp(22px, 1.146vw, 44px);
      --tv-body: clamp(13px, 0.677vw, 26px);
      --tv-control-space: clamp(310px, 16.146vw, 620px);
    }
    .tv-mode main {
      align-content: start;
      width: 100%;
      max-width: none;
      margin: 0;
    }
    .tv-mode .button {
      font-size: var(--tv-body);
      padding: clamp(10px, 0.521vw, 20px) clamp(16px, 0.833vw, 32px);
    }
    .tv-mode .local-sync,
    .tv-mode .clock-phase {
      font-size: var(--tv-body);
    }
    .tv-mode .room-sharing .invitation {
      max-width: none;
      padding: clamp(18px, 0.938vw, 36px);
    }
    .tv-mode .room-sharing img {
      max-width: clamp(240px, 12.5vw, 480px);
    }
    .tv-mode .room-sharing strong {
      font-size: clamp(24px, 1.25vw, 48px);
    }
    .tv-mode .room-sharing p {
      font-size: var(--tv-body);
    }
    .tv-mode .room-sharing input {
      font-size: clamp(11px, 0.573vw, 22px);
      padding: clamp(10px, 0.521vw, 20px);
    }

    .tv-mode .icon-button {
      width: clamp(44px, 2.292vw, 88px);
      height: clamp(44px, 2.292vw, 88px);
    }
    .tv-mode .transport svg {
      width: clamp(24px, 1.25vw, 48px);
      height: clamp(24px, 1.25vw, 48px);
    }
  }
</style>
