export type TabHref = "/" | "/texas";

/** Dashboard owns "/" and every player page; Texas owns "/texas". Other pages mark no tab. */
export function activeTab(pathname: string): TabHref | null {
  if (pathname === "/" || pathname.startsWith("/player/")) return "/";
  if (pathname === "/texas" || pathname.startsWith("/texas/")) return "/texas";
  return null;
}
