# Interface polish review

The review uses Emil Kowalski's public writing and the `emil-design-eng`,
`mobile-native`, `improve-animations` and `animation-performance` skills from
[emilkowalski/skills](https://github.com/emilkowalski/skills/tree/2d228630ba1446365f614a108cb8252f1feda202).
These are design references, not application dependencies.

| Before | After | Why |
| --- | --- | --- |
| A large scene precedes the room forms on phones | Forms precede the scene; welcome shortcuts focus the room-name or room-code field | Get visitors to the music quickly |
| Shared buttons have hover feedback only | Separate press feedback, capability-gated hover and a 120 ms press transition | Touch needs immediate feedback; disabled controls must remain still |
| Several touch inputs inherit small component text | A 16 px minimum for coarse pointers | Avoid involuntary input zoom without disabling user zoom |
| Edge-to-edge layouts have no safe-area contract | Viewport metadata and inset-aware header, main and footer spacing | Keep actions clear of notches and home indicators |
| Information paragraphs span up to 76 characters and narrow release stamps can overflow | A narrower reading layout, 65-character prose measure and wrapping release stamps | Improve reading and narrow-screen resilience |

The black/red identity, canonical logo, player timing, authorization, room data
and public routes are preserved. Keyboard focus is immediate. System reduced
motion and the saved animation preference still suppress movement.

The motion decisions follow
[You Don't Need Animations](https://emilkowal.ski/ui/you-dont-need-animations) and
[7 Practical Animation Tips](https://emilkowal.ski/ui/7-practical-animation-tips).
The invitation UI already provides persistent copy success/error feedback, so
the [toast article](https://emilkowal.ski/ui/building-a-toast-component) does not
justify adding another notification system.

Validation includes existing public-route, player, room and TV browser coverage,
with new 320 px coverage and shortcut focus checks. Physical phone keyboard,
safe-area behavior and touch feel still require hardware verification.
This source review does not establish production deployment.
