// The privacy policy page, in the field kit: the eyebrow on its railroad, then
// numbered sections on a hairline like the landing page's steps, and anything
// that leaves the machine as a where / what / why row. On a phone the three
// columns stack inside each row, each cell keeping its own label, so no table
// scrolls sideways.
import type { Dict, Locale } from "@/content/copy";
import { UPDATED, policy, type LedgerRow } from "@/content/privacy";
import { Bar } from "./Bar";
import { Foot } from "./Foot";

const COLS = ["where", "what", "why"] as const;

function Ledger({ heads, rows }: { heads: LedgerRow; rows: LedgerRow[] }) {
  return (
    <div className="ledger" role="table">
      <div className="ledger__row ledger__head" role="row">
        {COLS.map((k) => (
          <p key={k} className="label" role="columnheader">
            {heads[k]}
          </p>
        ))}
      </div>
      {rows.map((row) => (
        <div key={row.where} className="ledger__row" role="row">
          {COLS.map((k) => (
            <div key={k} className="ledger__cell" data-col={k} role="cell">
              <p className="label ledger__label">{heads[k]}</p>
              <p>{row[k]}</p>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function Privacy({ t, locale }: { t: Dict; locale: Locale }) {
  const doc = policy[locale];
  return (
    <>
      <Bar t={t} locale={locale} page="privacy" />
      <main>
        <section className="screen policy-head" aria-labelledby="privacy-title">
          <div className="screen__body">
            <p className="label eyebrow">{doc.eyebrow}</p>
            <h1 id="privacy-title" className="screen__title">
              {doc.title}
            </h1>
            <p className="label policy-head__updated">
              <time dateTime={UPDATED}>{doc.updated}</time>
            </p>
          </div>
        </section>

        <div className="policy">
          {doc.sections.map((s, i) => (
            <section key={s.id} id={s.id} className="policy__section" aria-labelledby={`${s.id}-h`}>
              <p className="step__n">{String(i + 1).padStart(2, "0")}</p>
              <div className="policy__body">
                <h2 id={`${s.id}-h`} className="step__title">
                  {s.heading}
                </h2>
                {s.paras.map((p) => (
                  <p key={p} className="policy__p">
                    {p}
                  </p>
                ))}
                {s.ledger && <Ledger heads={doc.heads} rows={s.ledger} />}
                {s.after?.map((p) => (
                  <p key={p} className="policy__p policy__p--after">
                    {p}
                  </p>
                ))}
                {s.links && (
                  <ul className="policy__links">
                    {s.links.map((l) => (
                      <li key={l.href}>
                        <a href={l.href} target="_blank" rel="noreferrer">
                          {l.label} <span aria-hidden>↗</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          ))}
        </div>
      </main>
      <Foot t={t} locale={locale} page="privacy" />
      <site-menu lang={locale} />
    </>
  );
}
