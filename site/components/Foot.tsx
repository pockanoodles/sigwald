// The footer every page ends on: the product's install, source and privacy
// policy, and the maker's portfolio and contact page on kaitosoeno.com.
import type { Dict, Locale } from "@/content/copy";
import { PORTFOLIO_URL, REPO_URL } from "@/content/channels";
import { pagePath, type Page } from "@/lib/routes";
import { Mark } from "./Mark";

export function Foot({ t, locale, page }: { t: Dict; locale: Locale; page: Page }) {
  const install = page === "landing" ? "#install" : `${pagePath(locale, "landing")}#install`;
  return (
    <footer className="foot">
      <div className="foot__brand">
        <Mark size={22} />
        <span>
          {t.footer.rights} · {t.footer.license}
        </span>
      </div>
      <div className="foot__cols">
        <div>
          <p className="label">{t.footer.product}</p>
          <ul>
            <li>
              <a href={install}>{t.nav.install}</a>
            </li>
            <li>
              <a href={REPO_URL}>{t.footer.source}</a>
            </li>
            <li>
              <a href={pagePath(locale, "privacy")} aria-current={page === "privacy" ? "page" : undefined}>
                {t.footer.privacy}
              </a>
            </li>
          </ul>
        </div>
        <div>
          <p className="label">{t.footer.maker}</p>
          <ul>
            <li>
              <a href={locale === "en" ? PORTFOLIO_URL : "https://kaitosoeno.com/ja/portfolio"}>{t.footer.portfolio}</a>
            </li>
            <li>
              <a href={locale === "en" ? "https://kaitosoeno.com/" : "https://kaitosoeno.com/ja"}>{t.footer.contact}</a>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
