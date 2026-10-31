import { fontVars } from "../_lib/fonts";
import { metadataFor, viewport } from "../_lib/meta";
import { ViewTransitionScript, ViewTransitionSurface } from "@/components/ViewTransition";
import "../globals.css";

export const metadata = metadataFor("en");
export { viewport };

export default function EnLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="dark" className={fontVars}>
      <head>
        <ViewTransitionScript />
        {/* kaitosoeno.com's menu pill, the one every page of the domain shows
            (personal-website components/site-menu/element.ts). Blocking and
            after the transition script, so the pill is in the first frame a
            page switch morphs into and its listeners run after this app's. It
            is a root path, outside this app's /sigwald base path. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/site/menu.js" />
      </head>
      <body>
        <ViewTransitionSurface />
        {children}
      </body>
    </html>
  );
}
