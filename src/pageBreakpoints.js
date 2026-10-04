// Page-width breakpoints (see pageWidth.js): the window ones (640, 768, …)
// less the left sidebar (14rem). No imports: tailwind.config.mjs reads this.
const SIDEBAR = 224
export const PAGE_BREAKPOINTS = { sm: 640 - SIDEBAR, md: 768 - SIDEBAR, lg: 1024 - SIDEBAR, xl: 1280 - SIDEBAR, '2xl': 1536 - SIDEBAR }
