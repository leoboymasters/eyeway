/**
 * Horizontal space taken by the pothole details rail on desktop (matches Index.tsx):
 * `right-3` + `w-[min(24rem,calc(100vw-1.5rem))]` in px (16px/rem).
 */
export function getPotholeDetailsSidebarInsetPx(): number {
  if (typeof window === 'undefined') return 0;
  const w = window.innerWidth;
  const marginRight = 12; // 0.75rem (right-3)
  const onePointFiveRem = 24; // 1.5rem
  const sidebarWidth = Math.min(384, w - onePointFiveRem); // min(24rem, 100vw - 1.5rem)
  return marginRight + sidebarWidth;
}
