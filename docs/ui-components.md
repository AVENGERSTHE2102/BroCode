# Waypoint interface components

The local redesign uses an ivory, charcoal, and muted-green palette. The public landing page is available at `/welcome` and at `/` for signed-out visitors. Existing authenticated workspace routing remains in place.

- `src/components/ui/button.tsx` adapts the official shadcn/ui Radix Button registry source to semantic CSS classes: https://ui.shadcn.com/r/styles/new-york/button.json . Radix Slot and class-variance-authority preserve composition and variant behavior.
- `src/components/fade-content.tsx` adapts React Bits FadeContent to its basic GSAP scroll-fade mode: https://reactbits.dev/r/FadeContent-TS-CSS.json . It retains animation-context cleanup and reduced-motion support, and leaves content visible before JavaScript initializes.
- Icons use Lucide React. The brand symbol and evidence-map illustration are native CSS/SVG.

The workflow switcher on the landing page is an illustrative preview, not live customer data or integration evidence. Buttons that enter the product lead to the existing authentication flow. No UI CDN scripts or external font requests are needed at runtime.

## Chat workspace (signed-in home)

The signed-in `/` route is a conversation surface modelled on Claude/Codex chat: `src/components/chat-shell.tsx` (sidebar with new question, recent investigations, sources/investigations views, workspace chip, sign out) hosting `src/app/workspace-ask-panel.tsx` (empty-state hero with starter prompts, auto-growing composer with workflow pill, threaded user/assistant turns, live run steps, citation chips, collapsible alternatives). Styles are in `src/app/chat.css`. `src/components/ui/textarea.tsx` adapts shadcn/ui Textarea and `src/components/shiny-text.tsx` adapts React Bits ShinyText (CSS only). Behaviour is unchanged: each question still creates a saved investigation and runs `/api/ask`; this was verified by typecheck only, not in a live browser session.

## Graph-first surfaces

`src/components/graph-canvas.tsx` renders any property graph as an interactive SVG (animated edges, hover focus, zoom/pan) using the dependency-free layout in `src/lib/graph-view.ts`. It is used in three places: the **Reasoning path** under each chat answer (built live from the `graphPaths` in streamed `tool_call` traces), the **Knowledge graph** explorer (`src/components/graph-explorer.tsx`, backed by `GET /api/graph/explore`, which applies the same role ACL as the agent tools), and the landing-page showcase. Owners/admins can load or remove a clearly labelled synthetic sample incident graph (`POST`/`DELETE /api/graph/sample`; records are `sample: true` with `sample:` ids) so the product can be demonstrated before a real source is connected — it is not evidence of a real integration.

## Cockpit (signed-in home)

The signed-in home is a dark "mission control" (`src/components/chat-shell.tsx`, `src/app/cockpit.css`): an icon rail, a full-bleed live knowledge-graph stage (`graph-explorer.tsx`: stats HUD, type distribution bars, search, node inspector, empty-state CTAs) and a docked agent panel (`workspace-ask-panel.tsx`). While the agent runs, each streamed `tool_call` trace's `graphPaths` are lifted to the stage so the entities and relationships it walks light up in real time and stay highlighted on the answer. Sources and Investigations open as light sheets.
