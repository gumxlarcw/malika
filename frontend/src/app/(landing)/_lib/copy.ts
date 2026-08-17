/**
 * The copy dictionary moved to `@/lib/siteCopy` when the header and footer
 * became site-wide chrome. Re-exported here so the landing's own components
 * keep their existing import path.
 */

export type { Lang, CopyKey, Copy, NotifItem } from "@/lib/siteCopy";
export { getCopy, getQuestions, getNotifItems } from "@/lib/siteCopy";
