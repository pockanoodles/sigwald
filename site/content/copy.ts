// Every string on the landing page, both languages, behind one Dict, so a
// missing translation is a type error instead of English on /sigwald/ja.
// Claims here describe what the product does today; check the code before
// adding one.

export type Locale = "en" | "ja";

export type ShotId = "today" | "focus" | "calendar" | "tasks";

export interface Dict {
  meta: { title: string; description: string };
  nav: { how: string; app: string; data: string; install: string; github: string; label: string };
  hero: {
    label: string;
    statement: string;
    sub: string;
    cta: { mac: string; windows: string; linux: string; other: string; source: string };
    more: string;
    dial: { now: string; next: string; free: string };
  };
  how: { eyebrow: string; title: string; steps: { title: string; body: string }[] };
  app: { eyebrow: string; title: string; note: string; shots: Record<ShotId, { tab: string; caption: string; alt: string }> };
  data: { eyebrow: string; title: string; body: string; points: string[] };
  install: {
    eyebrow: string;
    title: string;
    sub: string;
    soon: string;
    live: string;
    copy: string;
    copied: string;
    open: string;
    groups: Record<"mac" | "windows" | "linux" | "server", string>;
  };
  open: { eyebrow: string; title: string; body: string; cta: string; by: string; more: string };
  footer: { rights: string; license: string; source: string; privacy: string; portfolio: string; contact: string; product: string; maker: string };
}

const en: Dict = {
  meta: {
    title: "Sigwald: the one thing to do next",
    description:
      "Sigwald ranks everything on your calendar and task list, then tells you the one thing to do next. It is free, open source and keeps your data on your machine.",
  },
  nav: { how: "How it works", app: "The app", data: "Your data", install: "Download", github: "GitHub", label: "Sigwald" },
  hero: {
    label: "Open source · MIT",
    statement: "What should I do right now?",
    sub: "Sigwald reads your calendar, your tasks and the modules you turn on, then names the one thing to do next.",
    cta: { mac: "Download for macOS", windows: "Download for Windows", linux: "Download for Linux", other: "Download Sigwald", source: "Run it from source" },
    more: "or see every way to install",
    dial: { now: "Now", next: "Next", free: "Free until" },
  },
  how: {
    eyebrow: "How it works",
    title: "Sigwald does three things before it shows you anything.",
    steps: [
      {
        title: "It reads what you already use.",
        body: "It reads Google, Outlook and Apple calendars by their iCal links, and it connects to CalDAV calendars too. Modules add the rest, such as your Canvas courses, your goals and your workouts.",
      },
      {
        title: "It ranks by what is at stake.",
        body: "Due dates, what each task is worth and how much its goal matters go into one formula you can read. The order never changes for a reason you cannot see.",
      },
      {
        title: "It shows you one thing.",
        body: "Focus mode puts the next task, what you need for it and its deadline on one screen, with done, skip and later one key away.",
      },
    ],
  },
  app: {
    eyebrow: "The app",
    title: "Every screen answers the same question.",
    note: "Example data",
    shots: {
      today: { tab: "Today", caption: "Today ranks everything open, so the top row is always the one to start.", alt: "The Today screen: a ranked list of open tasks with the overdue one first." },
      focus: { tab: "Focus", caption: "Focus clears the screen down to one task and the deadline it is racing.", alt: "The Focus screen: one task with its course, its materials and a countdown." },
      calendar: { tab: "Calendar", caption: "The calendar holds your classes and meetings, and tasks drag into the open time.", alt: "The Calendar week view with classes and scheduled tasks." },
      tasks: { tab: "Tasks", caption: "Tasks read like a spreadsheet, with dense rows and a bar that shows the whole cell.", alt: "The Tasks list in dense rows with due dates and estimates." },
    },
  },
  data: {
    eyebrow: "Your data",
    title: "Your data stays on your machine.",
    body: "The desktop app runs its own database inside the app, so there is no account to make and no server to trust. Sigwald only talks to the services you connect, such as Canvas and your calendars.",
    points: [
      "There is no account, because the app signs you in by itself.",
      "Nothing reports back, since Sigwald has no analytics and no tracking.",
      "Connected accounts are stored encrypted on disk with AES-256-GCM.",
      "Self-host the server with Docker to reach the same data from every device.",
    ],
  },
  install: {
    eyebrow: "Download",
    title: "Get Sigwald wherever you work.",
    sub: "Every channel ships the same build from the same GitHub release.",
    soon: "Soon",
    live: "Available",
    copy: "Copy",
    copied: "Copied",
    open: "Open",
    groups: { mac: "macOS", windows: "Windows", linux: "Linux", server: "Self-host" },
  },
  open: {
    eyebrow: "Open source",
    title: "Sigwald is free and open source.",
    body: "The code is MIT licensed on GitHub.",
    cta: "View the source on GitHub",
    by: "Made by Kaito Soeno.",
    more: "See more of my work",
  },
  footer: { rights: "© 2026 Kaito Soeno", license: "MIT License", source: "Source", privacy: "Privacy", portfolio: "Portfolio", contact: "Contact", product: "Sigwald", maker: "Kaito Soeno" },
};

const ja: Dict = {
  meta: {
    title: "Sigwald｜次にやるべきことを、ひとつだけ",
    description:
      "Sigwald はカレンダーとタスクを順位づけし、次にやるべきことをひとつだけ示します。無料のオープンソースで、データはあなたのマシンに残ります。",
  },
  nav: { how: "しくみ", app: "アプリ", data: "データ", install: "ダウンロード", github: "GitHub", label: "Sigwald" },
  hero: {
    label: "オープンソース · MIT",
    statement: "今、何をやるべきか。",
    sub: "Sigwald はカレンダーとタスク、オンにしたモジュールを読み取り、次にやるべきことをひとつだけ示します。",
    cta: { mac: "macOS 版をダウンロード", windows: "Windows 版をダウンロード", linux: "Linux 版をダウンロード", other: "Sigwald をダウンロード", source: "ソースから動かす" },
    more: "インストール方法をすべて見る",
    dial: { now: "今", next: "次", free: "空き時間" },
  },
  how: {
    eyebrow: "しくみ",
    title: "画面に出す前に、Sigwald は 3 つのことをします。",
    steps: [
      {
        title: "いつものツールを読み取ります。",
        body: "Google・Outlook・Apple のカレンダーを iCal リンクで読み込み、CalDAV のカレンダーにもつながります。Canvas の授業や目標、トレーニングなどはモジュールで加えられます。",
      },
      {
        title: "かかっているものの大きさで並べます。",
        body: "締め切り、タスクごとの重み、目標の重要度を、誰でも読める式で計算します。見えない理由で順番が変わることはありません。",
      },
      {
        title: "ひとつだけ見せます。",
        body: "フォーカスモードでは、次のタスクとそれに必要なもの、締め切りが 1 画面に並び、完了・スキップ・あとでがキーひとつで選べます。",
      },
    ],
  },
  app: {
    eyebrow: "アプリ",
    title: "どの画面も、同じ問いに答えます。",
    note: "サンプルデータ",
    shots: {
      today: { tab: "今日", caption: "未完了のタスクをすべて順位づけするので、いちばん上の行から始めれば大丈夫です。", alt: "今日の画面。期限切れのタスクを先頭に、未完了のタスクが順位順に並んでいる。" },
      focus: { tab: "フォーカス", caption: "画面をひとつのタスクと、その締め切りまでの時間だけにします。", alt: "フォーカス画面。ひとつのタスクと授業、資料、残り時間が表示されている。" },
      calendar: { tab: "カレンダー", caption: "授業や予定が並び、空いた時間にタスクをドラッグできます。", alt: "授業と予定のタスクが入った週表示のカレンダー。" },
      tasks: { tab: "タスク", caption: "スプレッドシートのような密な行と、セルの全文を見せるバーで読めます。", alt: "締め切りと所要時間つきの密な行で並ぶタスク一覧。" },
    },
  },
  data: {
    eyebrow: "データ",
    title: "データは、あなたのマシンの中に。",
    body: "デスクトップ版はアプリの中で自前のデータベースを動かすので、作るべきアカウントも信頼すべきサーバーもありません。Sigwald が通信するのは、Canvas やカレンダーなど、あなたが接続したサービスだけです。",
    points: [
      "アプリが自動でサインインするので、アカウントは不要です。",
      "解析やトラッキングはなく、どこにもデータを送り返しません。",
      "接続したアカウントの情報は、AES-256-GCM で暗号化して保存します。",
      "Docker でサーバーをセルフホストすれば、どのデバイスからも同じデータを使えます。",
    ],
  },
  install: {
    eyebrow: "ダウンロード",
    title: "使う場所で、Sigwald を。",
    sub: "どの配布先にも、同じ GitHub リリースから同じビルドを届けます。",
    soon: "準備中",
    live: "公開中",
    copy: "コピー",
    copied: "コピーしました",
    open: "開く",
    groups: { mac: "macOS", windows: "Windows", linux: "Linux", server: "セルフホスト" },
  },
  open: {
    eyebrow: "オープンソース",
    title: "Sigwald は無料のオープンソースです。",
    body: "コードは MIT ライセンスで GitHub に公開しています。",
    cta: "GitHub でソースを見る",
    by: "制作は Kaito Soeno です。",
    more: "ほかの作品を見る",
  },
  footer: { rights: "© 2026 Kaito Soeno", license: "MIT License", source: "ソース", privacy: "プライバシー", portfolio: "作品", contact: "お問い合わせ", product: "Sigwald", maker: "Kaito Soeno" },
};

export const copy: Record<Locale, Dict> = { en, ja };
