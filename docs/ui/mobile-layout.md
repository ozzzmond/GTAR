# Mobile layout standard

Apply this standard to new and changed UI in `web/` below the `sm` breakpoint.
Desktop layout from `sm:` up is out of scope. Keep existing theme color tokens.

## Foundations

- Controls (buttons, dropdowns, search, segmented controls, drawer rows) are 44px tall with a 44px minimum (`min-h-11`) and `rounded-xl` (12px).
- Containers (song cards, sheets, modals, panels) use `rounded-2xl` (16px).
- Small icon tiles inside cards, such as the song icon tile, use `rounded-xl`.
- Chips, badges, count pills, and round icon buttons use `rounded-full`. Chips are 28px tall.
- Use 4, 8, 12, or 16px spacing (`gap-1`, `gap-2`, `gap-3`, `gap-4`). Do not use half-steps such as `1.5`, `2.5`, and `3.5`.
- Use a 16px page gutter, 12px card padding, and a 12px gap between cards.
- Use 12, 14, 16, or 20px text. The minimum is 12px. Do not use hardcoded `text-[9px]`, `text-[10px]`, and `text-[11px]`.
- Use 16px inline icons and 20px icons inside buttons.
- Allowed radii are `rounded-xl`, `rounded-2xl`, and `rounded-full`. Do not use `rounded`, `rounded-md`, `rounded-lg`, `rounded-3xl`, and arbitrary values such as `rounded-[20px]`.
- Tailwind already maps `rounded-xl` and `rounded-2xl` to the theme variables `--radius-xl` and `--radius-2xl`. Do not redefine these variables. Use Tailwind’s built-in `rounded-full`.
- Define the control height once as a shared token and reference it from components.

| Recommended token | Value |
| --- | --- |
| `--control-h` | 44px (`min-h-11`) |

## Anatomy

- **Song card.** Put title and artist on the left and the kebab menu on the right. Place metadata chips in the middle. Put status on the left and Stage on the right in the footer. Reserve space for the date even when it is absent so Stage keeps its size and position.
- **Toolbar.** Use 44px height and `rounded-xl` for every control. Keep labels on one line and fully visible.
- **Drawer row.** Order items as icon, label, count pill, and overflow menu. Use one heading style for every drawer section and the same dots style for all overflow menus.
- **Modal header.** Keep the title on one line with an ellipsis if it overflows. Allow at most two trailing controls (help and close). Put counts in a subtitle under the title.

```text
Song card                 Drawer row
Title            ⋮        Icon  Label  (Count)  ⋮
Artist
(Chip) (Chip)             Modal header
Status  [Date]  [Stage]   Title…  [Help] [Close]
                          Count
```

## When space is short

Apply these options in order.

1. Shorten the label to one word plus an icon.
2. Stack or wrap controls. Use at most three equal-width buttons per row. With four or more buttons, use a two-column grid.
3. Move secondary actions into an overflow menu.
4. Move content to another screen or section.

- Keep button labels on a single line, text at least 12px, and controls at least 44px tall.
- Keep content accessible without clipping. If a row scrolls horizontally, show a fade at the scroll edge.
- Keep destructive actions (for example Clear) out of the normal action row, and require a confirm.
- Keep the scrollable body at least half the viewport height. Make large footer panels collapsible or move them to the end of the scroll content.

## Verification

- Check every mobile screen at 360px wide. Verify that button labels stay on one line, controls remain fully visible, and tap targets are at least 44px.
- The owner must verify the layout on a real device before it can pass. Automated tests alone cannot establish a layout pass.
