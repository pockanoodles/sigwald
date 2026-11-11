// Sigwald's privacy policy, both languages. It sits beside copy.ts rather than
// inside it because it is a document, not interface strings, and it changes on
// its own schedule. It restates DATAFLOW.md (at the repository root) for
// visitors, so a change to what Sigwald sends belongs in both places, and
// UPDATED moves with it. src/lib/brand.ts and desktop/src/brand.ts point the app
// here, and so does Google's OAuth consent screen, so this URL must not move.
// kaitosoeno.com/privacy covers the portfolio's contact form and links here.
//
// Japanese is authored, not translated line by line.
import type { Locale } from "./copy";
import { REPO_URL } from "./channels";

export interface LedgerRow {
  where: string;
  what: string;
  why: string;
}

export interface PolicySection {
  id: string;
  heading: string;
  paras: string[];
  ledger?: LedgerRow[];
  after?: string[];
  links?: { label: string; href: string }[];
}

export interface PolicyDoc {
  meta: { title: string; description: string };
  eyebrow: string;
  title: string;
  updated: string;
  heads: LedgerRow;
  sections: PolicySection[];
}

export const UPDATED = "2026-11-11";

const EMAIL = "soenokaito1@gmail.com";
const LINKS = {
  googleApi: "https://developers.google.com/terms/api-services-user-data-policy",
  google: "https://policies.google.com/privacy",
  microsoft: "https://privacy.microsoft.com/privacystatement",
  instructure: "https://www.instructure.com/policies/privacy",
  github: "https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement",
  resend: "https://resend.com/legal/privacy-policy",
  cloudflare: "https://www.cloudflare.com/privacypolicy/",
  dataflow: `${REPO_URL}/blob/main/DATAFLOW.md`,
};

const en: PolicyDoc = {
  meta: {
    title: "Sigwald: privacy policy",
    description: "What Sigwald sends to the services you connect, where it goes, and why.",
  },
  eyebrow: "Privacy policy",
  title: "What Sigwald sends, where it goes, and why.",
  updated: "Last updated 11 November 2026",
  heads: { where: "Where", what: "What", why: "Why" },
  sections: [
    {
      id: "short",
      heading: "The short version",
      paras: [
        "Sigwald keeps your calendar, courses, tasks and goals in a database on your own device, or on a server that you or someone you trust runs. There is no Sigwald account with me, and Sigwald has no analytics, crash reporting or AI service, since the ranking is arithmetic done on your machine.",
        "Sigwald talks only to the services you connect, and only to sync them, so nothing you do in it reaches me.",
      ],
    },
    {
      id: "services",
      heading: "The services you connect",
      paras: [
        "A service hears from Sigwald only after you connect it. The Stats, People, Training, Nutrition, Work, Readouts, Golden hour and Inbox modules send nothing out of Sigwald.",
      ],
      ledger: [
        { where: "Google Calendar and Google Tasks", what: "Event and task titles, notes, locations and times in both directions, your sign-in tokens, and your account email once when you connect", why: "To show and update your calendar and tasks" },
        { where: "Microsoft Outlook and Microsoft To Do", what: "The same as Google", why: "To show and update your Outlook calendar and To Do tasks" },
        { where: "A CalDAV server you name", what: "Event content, plus your username and password on each request", why: "To sync that calendar" },
        { where: "The host of an iCal link you add", what: "A plain request for the link, which carries your IP address and none of your data", why: "To show that calendar, read-only" },
        { where: "Canvas, at your school's address, while the School module is on", what: "Your access token and read-only requests", why: "To bring in courses, assignments, grades and feedback, announcements, Inbox messages and course files, which are saved on your device" },
        { where: "A service a marketplace module reads (GitHub, Linear, Jira, Notion, Stripe and others), only while that module is on", what: "The token or key you connected it with, and read-only requests", why: "To turn your work, bookings and numbers there into tasks, calendar events and readings. Nothing is written back" },
        { where: "GitHub Releases, for GitHub downloads and the Homebrew and winget installs", what: "The app version, your platform and your IP address", why: "To check for updates, which store, Snap and Linux package builds never do" },
        { where: "Resend, on a server whose operator turns it on", what: "Your email address and a reset link", why: "To send a password reset email" },
      ],
      after: [
        "Passwords and tokens are encrypted on disk, and login passwords are stored only as hashes. Whoever runs a self-hosted Sigwald server holds that server's data and is responsible for it.",
      ],
      links: [
        { label: "Microsoft's privacy statement", href: LINKS.microsoft },
        { label: "Instructure's privacy policy", href: LINKS.instructure },
        { label: "GitHub's privacy statement", href: LINKS.github },
        { label: "Resend's privacy policy", href: LINKS.resend },
      ],
    },
    {
      id: "google",
      heading: "Google user data",
      paras: [
        "Sigwald's use and transfer of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements. Sigwald uses Google data only to show and sync your own calendar and tasks, never for advertising, and never passes it to anyone else.",
      ],
      links: [
        { label: "Google API Services User Data Policy", href: LINKS.googleApi },
        { label: "Google's privacy policy", href: LINKS.google },
      ],
    },
    {
      id: "page",
      heading: "This page",
      paras: [
        "This page is a static site that Cloudflare serves on kaitosoeno.com. It has no forms, cookies, analytics or third-party requests. Like any web host, Cloudflare sees the ordinary details of each request, such as your IP address and browser.",
      ],
      links: [{ label: "Cloudflare's privacy policy", href: LINKS.cloudflare }],
    },
    {
      id: "choices",
      heading: "Your choices",
      paras: [
        "Your data stays in Sigwald's database on your device or your server, so you can read or delete it there. Removing an account in Settings stops Sigwald from syncing it, and you can also revoke Sigwald's access from your Google or Microsoft account settings.",
        "Sigwald isn't directed at children under 13. If this policy changes, the date at the top changes with it.",
      ],
      links: [{ label: "DATAFLOW.md", href: LINKS.dataflow }],
    },
    {
      id: "contact",
      heading: "Contact",
      paras: [
        `Sigwald is made by Kaito Soeno, an individual in Boston, Massachusetts. Questions about this policy go to ${EMAIL}.`,
      ],
    },
  ],
};

const ja: PolicyDoc = {
  meta: {
    title: "Sigwald｜プライバシーポリシー",
    description: "Sigwald が接続したサービスに何を送り、どこへ届き、なぜそうするのか。",
  },
  eyebrow: "プライバシーポリシー",
  title: "Sigwald が送るもの、その送信先と目的。",
  updated: "最終更新 2026年11月11日",
  heads: { where: "送信先", what: "内容", why: "目的" },
  sections: [
    {
      id: "short",
      heading: "要点",
      paras: [
        "Sigwald は予定、授業、タスク、目標を、ご自身の端末か、ご自身または信頼できる人が運用するサーバーのデータベースに保存します。私が管理するアカウントはなく、優先順位づけは端末上の計算で行うため、アクセス解析、クラッシュレポート、AI サービスも使いません。",
        "Sigwald が通信するのは接続したサービスだけで、目的は同期に限られるため、利用内容が私に届くことはありません。",
      ],
    },
    {
      id: "services",
      heading: "接続するサービス",
      paras: [
        "Sigwald が外部のサービスと通信するのは、そのサービスを接続してからです。Stats、People、Training、Nutrition、Work、Readouts、Golden hour、Inbox の各モジュールは、Sigwald の外に何も送りません。",
      ],
      ledger: [
        { where: "Google カレンダーと Google ToDo リスト", what: "予定とタスクのタイトル、メモ、場所、日時（双方向）、ログイン用のトークン、接続時に一度だけ読むアカウントのメールアドレス", why: "予定とタスクを表示し、更新するため" },
        { where: "Microsoft Outlook と Microsoft To Do", what: "Google と同じ内容", why: "Outlook の予定と To Do のタスクを表示し、更新するため" },
        { where: "指定した CalDAV サーバー", what: "予定の内容と、毎回のリクエストに含まれるユーザー名とパスワード", why: "そのカレンダーを同期するため" },
        { where: "追加した iCal リンクの配信元", what: "リンクへの通常のリクエスト（IP アドレスを含み、ご自身のデータは含みません）", why: "そのカレンダーを読み取り専用で表示するため" },
        { where: "学校の Canvas（School モジュールが有効なときのみ）", what: "アクセストークンと読み取りのみのリクエスト", why: "授業、課題、成績とフィードバック、お知らせ、受信トレイのメッセージ、授業資料を取り込むためで、資料は端末に保存されます" },
        { where: "マーケットプレイスのモジュールが読むサービス（GitHub、Linear、Jira、Notion、Stripe など。そのモジュールが有効なときのみ）", what: "接続に使ったトークンまたはキーと、読み取りのみのリクエスト", why: "そこでの作業、予約、数値をタスク、カレンダーの予定、記録として取り込むためで、書き込みは一切しません" },
        { where: "GitHub Releases（GitHub からのダウンロード版、Homebrew 版、winget 版）", what: "アプリのバージョン、OS、IP アドレス", why: "アップデートを確認するためで、ストア版、Snap 版、Linux パッケージ版は確認しません" },
        { where: "Resend（運用者が有効にしたサーバーのみ）", what: "メールアドレスと再設定用リンク", why: "パスワード再設定のメールを送るため" },
      ],
      after: [
        "パスワードやトークンは暗号化して保存し、ログイン用のパスワードはハッシュとしてのみ保存します。自分で運用する Sigwald サーバーのデータは、そのサーバーの運用者が管理し、責任を持ちます。",
      ],
      links: [
        { label: "Microsoft のプライバシーに関する声明", href: LINKS.microsoft },
        { label: "Instructure のプライバシーポリシー", href: LINKS.instructure },
        { label: "GitHub のプライバシーに関する声明", href: LINKS.github },
        { label: "Resend のプライバシーポリシー", href: LINKS.resend },
      ],
    },
    {
      id: "google",
      heading: "Google のユーザーデータ",
      paras: [
        "Google API から受け取った情報の利用と移転は、Limited Use の要件を含む Google API サービスのユーザーデータに関するポリシーに従います。Google のデータはご自身の予定とタスクの表示と同期にだけ使い、広告には使わず、第三者に渡すこともありません。",
      ],
      links: [
        { label: "Google API サービスのユーザーデータに関するポリシー", href: LINKS.googleApi },
        { label: "Google のプライバシーポリシー", href: LINKS.google },
      ],
    },
    {
      id: "page",
      heading: "このページ",
      paras: [
        "このページは、Cloudflare が kaitosoeno.com で配信している静的なサイトです。フォーム、Cookie、アクセス解析、外部へのリクエストはありません。ほかのウェブサイトと同じく、Cloudflare は IP アドレスやブラウザーなど、リクエストに含まれる通常の情報を受け取ります。",
      ],
      links: [{ label: "Cloudflare のプライバシーポリシー", href: LINKS.cloudflare }],
    },
    {
      id: "choices",
      heading: "データの管理",
      paras: [
        "データはご自身の端末かサーバー上の Sigwald のデータベースにあるため、そこで確認や削除ができます。設定でアカウントを削除すると同期が止まり、Google や Microsoft のアカウント設定から Sigwald のアクセス権を取り消すこともできます。",
        "Sigwald は13歳未満の方を対象としていません。このポリシーを変更した場合は、冒頭の日付も更新します。",
      ],
      links: [{ label: "DATAFLOW.md", href: LINKS.dataflow }],
    },
    {
      id: "contact",
      heading: "お問い合わせ",
      paras: [
        `Sigwald は、米国マサチューセッツ州ボストン在住の個人、添野開仁が制作しています。このポリシーに関するご質問は ${EMAIL} までお送りください。`,
      ],
    },
  ],
};

export const policy: Record<Locale, PolicyDoc> = { en, ja };
