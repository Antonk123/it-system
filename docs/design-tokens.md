# Design Tokens Reference
## IT Ticketing System - Design System Documentation

---

## Overview

Detta projekt använder ett **5-tema system** med komplett support för theme-switching. Alla komponenter ska använda semantiska design tokens istället för hårdkodade färger.

### Tillgängliga teman
1. **Ocean Deep** (default) - Djupblå, professionell
2. **Cyberpunk** - Neon, futuristisk
3. **Arctic** - Ljusblå, ren
4. **Terminal** - Grön monokrom, tech
5. **Sunset** - Varm orange/röd

---

## ✅ Färger - DO USE (Theme-Aware)

### Backgrounds
```tsx
bg-background        // Huvudbakgrund (sidor)
bg-card              // Kortbakgrunder
bg-input             // Input-fält bakgrund
bg-popover           // Dropdown/popover bakgrund
bg-muted             // Tyst bakgrund (disabled states, secondary areas)
```

### Text
```tsx
text-foreground             // Primär text
text-muted-foreground       // Sekundär text, labels
text-card-foreground        // Text på card-bakgrunder
text-popover-foreground     // Text i popovers
text-primary                // Accent text (färgad)
text-primary-foreground     // Text på primary-bakgrund
text-destructive            // Error/danger text
text-destructive-foreground // Text på destructive-bakgrund
```

### Borders
```tsx
border-border        // Standard borders
border-input         // Input borders
border-primary       // Accent borders
border-destructive   // Error borders
```

### Semantic Colors (via CSS Variables)
```tsx
// Success (green)
text-[hsl(var(--success))]
bg-[hsl(var(--success)/0.1)]   // 10% opacity

// Destructive (red)
text-[hsl(var(--destructive))]
bg-[hsl(var(--destructive)/0.1)]

// Primary accent
text-[hsl(var(--primary))]
bg-[hsl(var(--primary)/0.1)]

// Accent secondary
text-[hsl(var(--accent))]
bg-[hsl(var(--accent)/0.1)]
```

---

## ❌ Färger - DO NOT USE (Theme-Breaking)

### Hårdkodade Tailwind-färger
```tsx
// ❌ UNDVIK
text-red-400
bg-zinc-800
border-gray-300
text-green-500
bg-blue-500

// ✅ ANVÄND ISTÄLLET
text-[hsl(var(--destructive))]
bg-card
border-border
text-[hsl(var(--success))]
bg-primary
```

### Inline HSL-värden utan variabler
```tsx
// ❌ UNDVIK
bg-[hsl(220_24%_13%)]
border-[hsl(220_20%_20%)]

// ✅ ANVÄND ISTÄLLET
bg-card
border-border
```

### Opacity-varianter av zinc/gray
```tsx
// ❌ UNDVIK
bg-zinc-900/80
text-zinc-300

// ✅ ANVÄND ISTÄLLET
bg-card/80
text-foreground/80
```

---

## 🎨 Interactive States - Standard Patterns

### Input Fields (Input, Select, Textarea)
```tsx
className="
  h-11 rounded-lg border border-border bg-input px-3 py-2
  text-foreground placeholder:text-muted-foreground
  hover:bg-input/80 hover:border-primary/40
  focus-visible:ring-2 focus-visible:ring-primary/30
  focus-visible:border-primary/60
  transition-all duration-200
"
```

### Primary Button
```tsx
className="
  bg-gradient-to-br from-primary via-primary to-primary/90
  hover:from-primary/90 hover:via-primary hover:to-primary
  active:scale-[0.98]
  shadow-lg shadow-primary/20 hover:shadow-primary/30
  text-primary-foreground
  transition-all duration-200
"
```

### Secondary Button
```tsx
className="
  bg-secondary text-secondary-foreground
  hover:bg-secondary/80
  active:scale-[0.98]
  transition-all duration-200
"
```

### Destructive Button
```tsx
className="
  bg-destructive text-destructive-foreground
  hover:bg-destructive/90
  active:scale-[0.98]
  transition-all duration-200
"
```

### Card Hover
```tsx
className="
  bg-card border border-border
  hover:border-primary/50 hover:bg-card/80
  hover:shadow-xl hover:shadow-primary/10
  hover:-translate-y-0.5
  transition-all duration-300
"
```

---

## 📏 Spacing Scale

### Card Padding
```tsx
p-4   // Compact cards (KPICard, list items, badges)
p-5   // Medium cards (mobile ticket cards)
p-6   // Standard cards (forms, content blocks)
p-8   // Hero cards (Login, modals, large forms)
```

### Inline Elements
```tsx
px-2 py-1        // Small badges
px-2.5 py-0.5    // Tiny badges
px-3 py-2        // Input padding
```

### Gaps
```tsx
gap-2       // Related items (8px)
gap-4       // Form fields, card grids (16px)
space-y-5   // Form field vertical spacing (20px)
space-y-6   // Page sections (24px)
```

---

## 🎭 Shadows

### Predefined Shadow Levels
```tsx
shadow-sm    // Badges, small elements
shadow-md    // Standard cards (default Card)
shadow-lg    // Buttons, elevated cards
shadow-xl    // Modals, dropdowns, hover states
shadow-2xl   // Dragging states, maximum elevation
```

### With Theme Tinting
Alla shadows använder automatiskt theme-färg via CSS-variabler.

```tsx
// Primary tinted shadows
shadow-lg shadow-primary/20           // Resting state
hover:shadow-xl hover:shadow-primary/30   // Hover state
```

---

## 🔘 Border Radius

### Per Theme
Border radius anpassar sig automatiskt per tema via `--radius`:
- **Ocean Deep**: `1rem` (generous)
- **Cyberpunk**: `0.5rem` (medium)
- **Terminal**: `0.375rem` (sharp)
- **Arctic**: `1rem` (generous)
- **Sunset**: `0.75rem` (balanced)

### Usage
```tsx
rounded-lg      // Cards (använder var(--radius))
rounded-md      // Nested elements
rounded-xl      // Inputs, buttons (intentional prominence)
rounded-2xl     // Hero elements (Login, modals)
```

---

## 🎬 Animations

### Duration
```tsx
duration-200    // Quick feedback (hover, focus)
duration-300    // Standard transitions (cards, buttons)
duration-500    // Entrance animations (Framer Motion)
```

### Scale Feedback
```tsx
active:scale-[0.98]   // Button press
active:scale-95       // Larger elements
hover:scale-105       // Subtle lift (optional)
```

### Translate
```tsx
hover:-translate-y-0.5   // Card lift
hover:-translate-y-1     // KPICard lift (more pronounced)
```

---

## 📱 Responsive

### Breakpoints (Tailwind default)
```tsx
sm:   // 640px
md:   // 768px
lg:   // 1024px
xl:   // 1280px
2xl:  // 1536px
```

### Pattern
```tsx
// Mobile-first
h-11 md:h-10       // 44px touch target mobile, 40px desktop
text-base md:text-sm   // Larger text mobile
```

---

## 🔍 Examples

### ✅ Correct Usage
```tsx
// Login button (Login.tsx)
<Button className="
  w-full h-11 rounded-xl
  bg-gradient-to-br from-primary via-primary to-primary/90
  hover:from-primary/90 hover:via-primary hover:to-primary
  active:scale-[0.98]
  shadow-lg shadow-primary/20 hover:shadow-primary/30
  transition-all duration-200
">
  Logga in
</Button>

// Input field (Login.tsx)
<Input className="
  h-11 rounded-xl
  bg-input border-border
  hover:bg-input/80 hover:border-primary/40
  focus-visible:ring-primary/30 focus-visible:border-primary/60
  transition-all duration-200
" />

// Card (KPICard.tsx)
<Card className="
  relative overflow-hidden
  transition-all duration-300
  hover:-translate-y-1
  hover:shadow-2xl hover:shadow-primary/20
">
  <CardContent className="p-4">
    {/* content */}
  </CardContent>
</Card>
```

### ❌ Incorrect Usage
```tsx
// Hårdkodade färger
<div className="bg-zinc-800/60 border-zinc-700 text-zinc-300">

// Inline HSL utan variabler
<div className="bg-[hsl(220_24%_13%)]">

// Tailwind-färger istället för theme tokens
<span className="text-red-400">Error</span>
<span className="text-green-500">Success</span>
```

---

## 🧪 Testing Checklist

### Per Change
- [ ] **Visual test**: Ser komponenten korrekt ut?
- [ ] **Theme test**: Testa ALLA 5 teman (Ocean, Cyberpunk, Arctic, Terminal, Sunset)
- [ ] **Interaction test**: Hover, focus, active states fungerar?
- [ ] **Responsive test**: Mobile (375px) och Desktop (1440px)

### Accessibility
- [ ] **Kontrast**: Text ≥4.5:1, UI-element ≥3:1
- [ ] **Focus states**: Synliga focus rings på alla interaktiva element
- [ ] **Keyboard nav**: Tab-ordning matchar visuell ordning
- [ ] **Screen reader**: aria-labels på icon-only knappar

---

## 🚀 Development Workflow

### 1. Använd Rätt Token
```bash
# När du behöver en färg, FRÅGA:
# "Vad är syftet?"
# - Bakgrund → bg-background / bg-card / bg-input
# - Text → text-foreground / text-muted-foreground
# - Border → border-border
# - Accent → text-primary / bg-primary
```

### 2. Testa Theme-Switching
```bash
# Efter varje ändring:
1. Öppna Settings → Välj tema
2. Växla mellan alla 5 teman
3. Verifiera att komponenten ser bra ut i alla
```

### 3. Docker Rebuild
```bash
# Efter frontend-ändringar:
docker-compose build frontend
docker-compose up -d
```

---

## 📚 Reference Components

### Guldstandard (Använd som mall)
- **Login.tsx** - Modern authentication UI
- **Input.tsx** - Konsistenta input hover states
- **Button.tsx** - Gradient button patterns
- **Card.tsx** - Hover lift effects
- **PriorityBadge.tsx** - Correct theme token usage
- **StatusBadge.tsx** - Semantic color system

### Config-filer (Ändra EJ)
- **tailwind.config.ts** - Tema-definitioner
- **index.css** - CSS-variabler och tema-switcher
- **shadcn components** - UI-komponentbibliotek

---

## 🎯 Design Philosophy

### Principer
1. **Theme-First**: Alla färger via tokens, aldrig hårdkodade
2. **Consistency**: Samma patterns överallt (hover, focus, spacing)
3. **Feedback**: Varje interaktion ska ha visuell feedback
4. **Performance**: Optimera animationer (transform/opacity only)
5. **Accessibility**: WCAG AA minimum (4.5:1 kontrast)

### When in Doubt
- **Färg?** → Använd semantisk token
- **Spacing?** → Följ 4/8dp-systemet
- **Animation?** → 200-300ms, transform/opacity only
- **Shadow?** → Använd predefined levels
- **Radius?** → Låt tema bestämma (rounded-lg)

---

## 🐛 Common Mistakes

### 1. Hårdkodad färg istället för token
```tsx
// ❌ DÅLIGT
<div className="bg-gray-100 text-gray-800">

// ✅ BRA
<div className="bg-muted text-foreground">
```

### 2. Mixing color systems
```tsx
// ❌ DÅLIGT - Blandar zinc och theme tokens
<div className="bg-card text-zinc-300">

// ✅ BRA - Konsekvent token-användning
<div className="bg-card text-muted-foreground">
```

### 3. Animated width/height (performance)
```tsx
// ❌ DÅLIGT - Orsakar reflow
<div className="transition-all hover:w-64">

// ✅ BRA - GPU-accelererad
<div className="transition-transform hover:scale-105">
```

### 4. No hover feedback
```tsx
// ❌ DÅLIGT - Ingen feedback
<button className="bg-primary">Click</button>

// ✅ BRA - Tydlig feedback
<button className="bg-primary hover:bg-primary/90 active:scale-[0.98] transition-all">
  Click
</button>
```

---

## 📞 Support

### Frågor?
- Kolla referens-komponenter (Login.tsx, Button.tsx, Card.tsx)
- Testa i alla 5 teman
- Följ design tokens-guiden

### Bidra
- Följ denna guide vid alla UI-ändringar
- Testa theme-switching innan commit
- Dokumentera nya patterns här

---

**Senast uppdaterad**: 2026-03-17
**Version**: 1.0
**Maintainer**: IT Support Team
