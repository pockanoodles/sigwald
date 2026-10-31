// A Playwright sweep of the built page: both languages, a laptop and a phone.
// It loads the page the way a visitor does and drives the parts that move, so
// a broken interaction fails here rather than on kaitosoeno.com.
//
//   npm run build && npx wrangler dev --port 3230   (or any static server on dist/)
//   BASE=http://localhost:3230 npm run verify
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3230";
// The site's menu pill (/site/menu.js) is served by personal-website, so it is
// only there where the whole domain is: live, or `npm run stack` in that repo.
// On this site's own preview its 404 is expected, and only there is it let go;
// wherever the site is served, a missing pill fails.
const standalone = !(await fetch(BASE + "/site/menu.js").then((r) => r.ok, () => false));
const pillScript = (url) => standalone && /\/site\/menu\.js$/.test(new URL(url || BASE).pathname);
const PAGES = [
  { path: "/sigwald/", lang: "en", h1: "What should I do right now?", tabs: ["Today", "Focus", "Calendar", "Tasks"] },
  { path: "/sigwald/ja/", lang: "ja", h1: "今、何をやるべきか。", tabs: ["今日", "フォーカス", "カレンダー", "タスク"] },
];
const VIEWPORTS = [
  { name: "laptop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
];

const failures = [];
const check = (ok, what) => {
  if (!ok) failures.push(what);
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
};

const browser = await chromium.launch();
for (const pg of PAGES) {
  for (const vp of VIEWPORTS) {
    const tag = `${pg.lang}/${vp.name}`;
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    const errors = [];
    page.on("console", (m) => m.type() === "error" && !pillScript(m.location()?.url) && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("response", (r) => r.status() >= 400 && !pillScript(r.url()) && errors.push(`${r.status()} ${r.url()}`));
    const res = await page.goto(BASE + pg.path, { waitUntil: "networkidle" });
    check(res?.status() === 200, `${tag}: page answers 200`);
    check((await page.getAttribute("html", "lang")) === pg.lang, `${tag}: <html lang="${pg.lang}">`);
    check((await page.textContent("h1"))?.trim() === pg.h1, `${tag}: the statement is the h1`);

    // The dial draws: its canvas has non-empty pixels.
    const inked = await page.evaluate(() => {
      const c = document.querySelector(".dial canvas");
      if (!c || !c.width) return false;
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 0) return true;
      return false;
    });
    check(inked, `${tag}: the dial is drawn`);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(overflow <= 0, `${tag}: no sideways scroll (${overflow}px)`);

    // The tour shows exactly one screenshot, and the tabs switch it.
    for (const label of pg.tabs) {
      await page.getByRole("tab", { name: label }).click();
      const shown = await page.locator(".tour__shot img:not([hidden])").count();
      const selected = await page.getByRole("tab", { name: label }).getAttribute("aria-selected");
      check(shown === 1 && selected === "true", `${tag}: tab "${label}" shows one screenshot`);
    }
    const broken = await page.evaluate(() =>
      [...document.querySelectorAll(".tour__shot img")].filter((img) => img.complete && img.naturalWidth === 0).length
    );
    check(broken === 0, `${tag}: every screenshot loads`);

    // Every channel says whether it is live, and only live ones offer a box.
    const statuses = await page.locator(".channel .status").count();
    const channelsCount = await page.locator(".channel").count();
    check(statuses === channelsCount && channelsCount >= 9, `${tag}: ${channelsCount} channels, each with a status`);
    const live = await page.locator(".channel:has(.status--live)").count();
    const boxes = await page.locator(".channel__cmd").count();
    check(live >= 1 && boxes === live, `${tag}: ${live} live channels, each with a box, and no box on the rest`);
    const clipped = await page.$$eval(".channel__cmd code", (els) => els.filter((el) => el.scrollWidth > el.clientWidth + 1).length);
    check(clipped === 0, `${tag}: no command is cut off`);

    // The site's MENU pill (<site-menu>, from kaitosoeno.com's /site/menu.js)
    // opens and closes, wherever the site serves it. The pill grows into its
    // drawer on a spring and fades it out on close, so each check waits for
    // the motion to settle.
    if (!standalone) {
      check(await page.evaluate(() => !!customElements.get("site-menu")), `${tag}: the site's menu pill loads`);
      const pill = page.getByRole("button", { name: pg.lang === "en" ? /menu/i : /メニュー/ });
      check((await pill.innerText()).trim() === (pg.lang === "en" ? "MENU" : "メニュー"), `${tag}: the pill says only the word`);
      await pill.click();
      await page.waitForTimeout(600);
      check(await page.locator("site-menu #drawer").isVisible(), `${tag}: the site menu opens`);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(450);
      check(!(await page.locator("site-menu #drawer").isVisible()), `${tag}: Escape closes it`);
    }

    check(errors.length === 0, `${tag}: no console errors or failed requests${errors.length ? ` (${errors.slice(0, 3).join(" | ")})` : ""}`);
    await page.close();
  }
}
await browser.close();

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
