# Kito character design

## Source and design goal

Kito is an original eye-based robot whose visual starting point is the owner's
legacy mascot in `legacy/electron/mascot/jicho-mascot.css`,
`jicho-mascot.js`, and `icons/`. Keep the recognizable gray hood, inset dark
visor, paired luminous eyes, and small shoulder/neck seams. Do not reuse the
upstream character's plush body, eye poses, emote poses, greeting, or outfit
drawings.

The renderer uses a normalized body radius `R`. A full Kito has a broad round
helmet with a shoulder shell tucked under its lower edge. The outer hood is a
soft vertical oval; a darker inner rim separates it from the visor. The visor
is a wide rounded rectangle, about `1.28R` wide and `0.66R` high, with a small
upper-left reflection. The shoulder shell narrows toward the neck and ends in
two warm connector seams. The two eyes sit inside the visor at roughly
`±0.28R`, leaving room for their light halos. Small Kitos keep the same hood,
visor, and eye proportions without the shoulder shell or accessories that
would disappear at icon scale.

## Materials and light

| Part | Colour |
|---|---|
| Hood highlight | `#A7AAB0` |
| Hood shadow | `#777A81` |
| Inner rim | `#5F6269` |
| Visor highlight | `#23252B` |
| Visor shadow | `#0B0C0F` |
| Connector seams | `#E8B9A0` |
| Resting eye glow | `#FF8A80` |
| Eye core | `#FFE3DF` |

Each eye is a glowing rounded capsule with a smaller bright core. The glow is
soft and local to the visor; it does not tint the whole robot. State accents
replace the coral glow while the inner core stays pale. The body remains slate
in every state and outfit; the pumpkin look adds orange panels and a crown
stem while keeping the visor exposed.

## State expressions

State names and state-machine transitions remain the existing JichoBot API.
The visible expression is composed from eye geometry, gaze, shell pose, and
light. These are new choreographies rather than renamed or retimed upstream
expressions.

| State | Accent | Eye expression and motion |
|---|---|---|
| `idle` | Coral `#FF8A80` | Two upright capsules hold a soft breathing halo. The eyes make an occasional short glance before returning to the viewer. |
| `working` | Cyan `#5FD6FF` | Both capsule cores sweep together from inner to outer edge, pause, and return; the eye housings answer with a double focus pulse. |
| `thinking` | Violet `#8B5CF6` | The hood glances high-right; the left lens contracts to a dot and the right core follows the gaze after 0.24 seconds. A four-beat head turn carries the gaze back to centre. |
| `searching` | Indigo `#6365F2` | The eyes separate their motion: one core scans left while the other scans right, holds at the edge, then both snap to centre. |
| `approval` | Amber `#FFB13B` | Both lenses widen, flash twice with a small gap, and hold steady for the decision. The shell makes one forward lean. |
| `question` | Teal `#22D3EE` | One eye stays pill-shaped while the other draws a small loop for 0.72 seconds and resolves into a dot; the shell tilts twice and straightens. |
| `error` | Red `#F4425E` | The lenses flatten into bars in alternating order for two beats and settle into flat red windows after a contained three-part recoil. |
| `finished` | Green `#34D499` | The left eye draws an upward crescent first; the right follows after 0.32 seconds. Three green motes leave the visor and fade. |
| `ratelimit` | Orange `#FB9251` | Upper shutters lower over the eyes in 0.42 seconds, the cores pulse once, and a single small sweat mark slides off the hood. |
| `sleeping` | Blue-gray `#94A2B8` | The lenses settle into thin horizontal slits while the hood lowers and rises through one slow breathing cycle. |
| `dizzy` | Pink `#F472B6` | A bright core spirals inside each lens in opposite directions while the hood makes a short alternating sway, then levels. |

## Emotes

An emote keeps the robot's paired eye hardware visible. The graphic is a lens
overlay or an eye-specific motion, not a replacement mascot face. Each emote
has its own entry, hold, and exit sequence:

| Emote | Expression |
|---|---|
| `love` | Rose heart lenses swell with the eye housings, then rock once and settle back to coral. Two hearts leave the visor. |
| `surprised` | The lenses dip closed, spring wide, contract once, then return to their normal size. |
| `proud` | Two star lenses flare as the hood lifts and holds a clear upward angle. |
| `wink` | One capsule stays bright while the other closes into a curved wink; the visor glances left, then returns to centre. |
| `yawn` | The shell stretches, settles into a long compressed hold, then reopens; one sleep mote drifts away. |
| `happy` | Two unequal crescent eyes draw from centre outward while the hood makes one settling bob and a small eye pulse. |
| `annoyed` | The lenses flatten as the hood tilts twice and gives one short side-to-side recoil before returning to neutral. |

## Greeting

The inline greeting in the engine uses a new eye salute rather than the
upstream hand wave. The visor starts dark, both eyes open wide at 0.14 seconds,
settle into coral capsules at 0.33 seconds, then one eye closes into a curved
wink at 0.61 seconds while the other holds a warm pulse. Both eyes draw upward
crescents at 0.91 seconds as the hood gives a small forward nod, then the hood
levels and the capsules return to idle at 1.45 seconds. It uses no waving arm
or copied greeting pose.

The full launch introduction uses those same eye shapes in a longer scene
composition: the visor opens wide at 0.72 seconds, returns to capsules at 1.04,
winks at 1.36, and draws the paired crescents at 1.72. The hood then nods and
the whole character tucks into the compact island. Windows and macOS share this
launch choreography; Android uses the inline eye salute.

## Outfit placement

All outfit anchors and front/back layers are adapted for the hood, visor, and
shoulder shell. They keep both eyes readable unless the outfit is explicitly
eyewear. Three-dimensional anchors follow the hood when Kito turns; hats and ears sit behind the hood
first and finish in front of its crown, while neck items sit below the visor.

| Outfit | Placement on Kito |
|---|---|
| `partyHat` | A small cone sits on the crown seam, tilted slightly back; its elastic band stays above the visor. |
| `beanie` | A close cap follows the hood curve and ends in a short ribbed cuff above the visor; the pom sits on the rear crown. |
| `crown` | A low metal band follows the hood arc, with short points and jewels kept clear of the eye windows. |
| `sunglasses` | Two dark lenses clip over the existing eye windows and retain a small state-colour edge glint. |
| `roundGlasses` | Two circular rims align to the eye anchors on the visor, with a bridge across the centre seam. |
| `bow` | A soft bow fastens to the lower-left shoulder seam and does not cover the visor. |
| `scarf` | A band wraps the base of the hood; two short tails rest over the shoulder shell. |
| `witchHat` | A broad, curved brim follows the crown contour; the cone leans back and the brim remains behind the visor. |
| `pumpkin` | Orange segmented panels fit over the hood shell, with a green stem on the crown; the dark visor and eye windows remain open. |
| `santaHat` | A soft cap follows the crown, with its brim above the visor and a pom at the rear edge. |
| `bunnyEars` | Two padded ears anchor behind the crown seam and angle independently; their bases do not hide the visor. |

`none` has no accessory and `auto` resolves to the existing seasonal choice.
Wardrobe identifiers and selection behavior remain unchanged.

## Cross-platform drawing contract

TypeScript is the reference implementation. Kotlin and Swift use the same
normalized geometry, palette, eye-state choreography, emote choreography,
greeting beats, accessory anchors, and draw order. Canvas, Compose, and SwiftUI
may use their native path APIs, but must preserve those visible results and
the existing public engine interfaces.
