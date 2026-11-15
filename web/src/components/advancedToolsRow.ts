/** The Settings popover row style as a static card: not clickable itself, without its own bottom margin. */
export const flatRow = (rowClass: string) => rowClass.replace('cursor-pointer', '').replace(/\bmb-\d\b/, '')

/**
 * Advanced Tools launcher row: a Settings row holding a launcher button and a switch. The row keeps
 * the Settings height; its two controls keep their own 44px targets.
 */
export const launcherRow = (rowClass: string) => `${flatRow(rowClass)} py-0! pr-2.5!`

/** The launcher button inside a row: icon, label and chevron laid out like a Settings row. */
export const launcherButton = 'flex flex-1 min-w-0 min-h-11 -my-px items-center gap-2.5 text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-app-action rounded-lg'

/** Flat row icon, the same size and color as the Settings menu icons. */
export const launcherIcon = 'w-4 h-4 text-app-action shrink-0'

/** Hit area of a row's on/off switch. */
export const launcherSwitch = 'min-w-[44px] min-h-[44px] -my-px inline-flex items-center justify-center cursor-pointer select-none ml-1'
