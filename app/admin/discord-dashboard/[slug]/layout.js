// Client page → metadata lives in this server layout. See app/order/[code]/layout.js.
//
// SECURITY: the [slug] segment IS the ADMIN_DASHBOARD_SECRET — the whole point of the route
// is that it's unguessable — so it must never be interpolated into the title. A title is
// surfaced in the tab, in browser history, in window switchers and in every screenshot of
// them, all of which outlive the session and none of which the admin thinks of as secret.
// The title here is deliberately static and says nothing about which deployment it is.
//
// `robots` marks the route noindex/nofollow so the secret URL can't end up in a search
// index if it ever leaks into a referrer header, a shared link, or a crawler's path list.
export const metadata = {
  title: 'Dashboard',
  robots: { index: false, follow: false, nocache: true },
}

export default function DiscordDashboardLayout({ children }) {
  return children
}
