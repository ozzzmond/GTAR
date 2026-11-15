/** Advanced Tools launcher row: the popover row style as one flat card, without its own bottom margin. */
export const launcherRow = (rowClass: string) =>
  `${rowClass.replace('cursor-pointer', '').replace(/\bmb-\d\b/, '')} py-1! pl-2.5! pr-1.5!`
