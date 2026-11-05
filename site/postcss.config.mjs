// The site is its own package inside the app's repo. Without a PostCSS config
// of its own, Next climbs to the app's, which loads Tailwind from the repo
// root's node_modules, so the site wouldn't build where only its own packages
// are installed. No page here uses Tailwind, and a config that names no plugins
// passes the CSS through as written, as the app's did.
/** @type {import('postcss-load-config').Config} */
const config = { plugins: {} };

export default config;
